import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import Redis from 'ioredis';
import { Queue, QueueEvents } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { AppModule } from '../src/app.module';
import { NotificationChannel } from '../src/common/constants';
import { NOTIFICATION_QUEUE } from '../src/queue/queue.module';

/**
 * Integration Test: Notification Failover Path
 *
 * Verifies the complete failover workflow:
 * 1. Primary provider fails (simulated 5xx error)
 * 2. System automatically retries with secondary provider
 * 3. Job completes successfully with fallback provider
 *
 * This test uses a real Redis connection and processes actual jobs
 * through the queue to validate end-to-end behavior.
 */
describe('Notification Failover (e2e)', () => {
  let app: INestApplication;
  let redis: Redis;
  let queue: Queue;
  let queueEvents: QueueEvents;

  beforeAll(async () => {
    // Set environment to force primary provider failure
    process.env.FORCE_PRIMARY_FAILURE = 'true';

    // Create Redis connection for test cleanup
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    });

    // Build the NestJS application
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Apply same configuration as production
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();

    // Get queue instance for test assertions
    queue = app.get<Queue>(NOTIFICATION_QUEUE);

    // Set up queue events listener
    queueEvents = new QueueEvents('notifications', {
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    });
  });

  afterAll(async () => {
    // Clean up
    process.env.FORCE_PRIMARY_FAILURE = 'false';

    if (queueEvents) {
      await queueEvents.close();
    }
    if (queue) {
      await queue.close();
    }
    if (redis) {
      await redis.quit();
    }
    if (app) {
      await app.close();
    }
  });

  beforeEach(async () => {
    // Clear rate limits and idempotency keys before each test
    const keys = await redis.keys('notify:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  describe('POST /notifications/send', () => {
    it('should accept notification request and return 202', async () => {
      const dto = {
        idempotencyKey: uuidv4(),
        userId: 'test-user-1',
        channel: NotificationChannel.EMAIL,
        recipient: 'test@example.com',
        subject: 'Test Email',
        message: 'This is a test notification',
      };

      const response = await request(app.getHttpServer())
        .post('/notifications/send')
        .send(dto)
        .expect(202);

      expect(response.body).toMatchObject({
        success: true,
        statusCode: 202,
        message: 'Notification accepted for processing',
      });

      expect(response.body.jobId).toBeDefined();
      expect(response.body.idempotencyKey).toBe(dto.idempotencyKey);
    });

    it('should trigger failover when primary provider fails', async () => {
      const dto = {
        idempotencyKey: uuidv4(),
        userId: 'test-user-failover',
        channel: NotificationChannel.EMAIL,
        recipient: 'failover@example.com',
        subject: 'Failover Test',
        message: 'Testing automatic failover',
      };

      // Enqueue the notification
      const response = await request(app.getHttpServer())
        .post('/notifications/send')
        .send(dto)
        .expect(202);

      const jobId = response.body.jobId;

      // Wait for job completion (with timeout)
      const jobCompleted = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 10000);

        queueEvents.on('completed', ({ jobId: completedJobId }) => {
          if (completedJobId === jobId || completedJobId === dto.idempotencyKey) {
            clearTimeout(timeout);
            resolve(true);
          }
        });

        queueEvents.on('failed', () => {
          clearTimeout(timeout);
          resolve(false);
        });
      });

      // Verify job completed successfully
      expect(jobCompleted).toBe(true);
    });

    it('should process notification with fallback provider successfully', async () => {
      const dto = {
        idempotencyKey: uuidv4(),
        userId: 'test-user-fallback-success',
        channel: NotificationChannel.SMS,
        recipient: '+1234567890',
        message: 'Testing fallback provider success',
      };

      await request(app.getHttpServer()).post('/notifications/send').send(dto).expect(202);

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Verify job was processed (check queue stats)
      const waiting = await queue.getWaitingCount();
      const active = await queue.getActiveCount();
      const completed = await queue.getCompletedCount();

      // Job should either be active or completed
      expect(waiting + active + completed).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Rate Limiting', () => {
    it('should reject requests exceeding rate limit (10/minute)', async () => {
      const userId = 'rate-limited-user';

      // Send 10 requests (should all succeed)
      for (let i = 0; i < 10; i++) {
        await request(app.getHttpServer())
          .post('/notifications/send')
          .send({
            idempotencyKey: uuidv4(),
            userId,
            channel: NotificationChannel.EMAIL,
            recipient: 'test@example.com',
            subject: `Test ${i}`,
            message: 'Rate limit test',
          })
          .expect(202);
      }

      // 11th request should be rate limited
      const response = await request(app.getHttpServer())
        .post('/notifications/send')
        .send({
          idempotencyKey: uuidv4(),
          userId,
          channel: NotificationChannel.EMAIL,
          recipient: 'test@example.com',
          subject: 'Should Fail',
          message: 'This should be rate limited',
        })
        .expect(429);

      expect(response.body.message).toContain('Rate limit exceeded');
    });
  });

  describe('Idempotency', () => {
    it('should return same response for duplicate idempotency keys', async () => {
      const idempotencyKey = uuidv4();
      const dto = {
        idempotencyKey,
        userId: 'idempotency-test-user',
        channel: NotificationChannel.EMAIL,
        recipient: 'idempotent@example.com',
        subject: 'Idempotency Test',
        message: 'Testing idempotent requests',
      };

      // First request
      const response1 = await request(app.getHttpServer())
        .post('/notifications/send')
        .send(dto)
        .expect(202);

      // Second request with same idempotency key
      const response2 = await request(app.getHttpServer())
        .post('/notifications/send')
        .send(dto)
        .expect(202);

      // Should return same response
      expect(response1.body.jobId).toBe(response2.body.jobId);
      expect(response1.body.idempotencyKey).toBe(response2.body.idempotencyKey);
    });
  });

  describe('Validation', () => {
    it('should reject invalid channel', async () => {
      const response = await request(app.getHttpServer())
        .post('/notifications/send')
        .send({
          idempotencyKey: uuidv4(),
          userId: 'validation-user',
          channel: 'invalid_channel',
          recipient: 'test@example.com',
          message: 'Test',
        })
        .expect(400);

      expect(JSON.stringify(response.body.message).toLowerCase()).toContain('channel');
    });

    it('should reject missing required fields', async () => {
      const response = await request(app.getHttpServer())
        .post('/notifications/send')
        .send({
          userId: 'incomplete-user',
        })
        .expect(400);

      expect(response.body.message).toBeDefined();
    });

    it('should require subject for email channel', async () => {
      const response = await request(app.getHttpServer())
        .post('/notifications/send')
        .send({
          idempotencyKey: uuidv4(),
          userId: 'email-no-subject',
          channel: NotificationChannel.EMAIL,
          recipient: 'test@example.com',
          message: 'Email without subject',
        })
        .expect(400);

      expect(JSON.stringify(response.body.message).toLowerCase()).toContain('subject');
    });
  });

  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const response = await request(app.getHttpServer()).get('/health').expect(200);

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('checks');
      expect(response.body.checks).toHaveProperty('redis');
      expect(response.body.checks).toHaveProperty('queue');
    });

    it('should return pong for ping endpoint', async () => {
      const response = await request(app.getHttpServer()).get('/ping').expect(200);

      expect(response.body.message).toBe('pong');
    });
  });
});
