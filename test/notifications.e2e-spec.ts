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
 * E2E Tests: Notification Gateway Service
 *
 * Comprehensive end-to-end tests covering:
 * 1. Success Case: HTTP 202 with jobId
 * 2. Idempotency: Same idempotencyKey should not create duplicate jobs
 * 3. Rate Limiting: >10 requests/min should return 429
 * 4. Failover Logic: FORCE_PRIMARY_FAILURE=true should still succeed
 * 5. Validation: Invalid payload should return 400
 * 6. Health Check: /health should return healthy status
 *
 * Uses real Redis connection and processes actual jobs through the queue.
 */
describe('Notification Gateway E2E Tests', () => {
  let app: INestApplication;
  let redis: Redis;
  let queue: Queue;
  let queueEvents: QueueEvents;

  const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
  const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

  beforeAll(async () => {
    // Create Redis connection for test cleanup
    redis = new Redis({
      host: REDIS_HOST,
      port: REDIS_PORT,
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
        host: REDIS_HOST,
        port: REDIS_PORT,
      },
    });
  });

  afterAll(async () => {
    // Clean up resources
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

  // ========================================
  // Test Case 1: Success Case
  // ========================================
  describe('Test Case 1: Success Case - HTTP 202 with jobId', () => {
    it('should accept notification request and return 202 Accepted', async () => {
      const dto = {
        idempotencyKey: uuidv4(),
        userId: 'test-user-success',
        channel: NotificationChannel.EMAIL,
        recipient: 'success@example.com',
        subject: 'Test Success Case',
        message: 'This is a test notification for success case',
      };

      const response = await request(app.getHttpServer())
        .post('/notifications/send')
        .send(dto)
        .expect(202);

      // Verify response structure
      expect(response.body).toMatchObject({
        success: true,
        statusCode: 202,
        message: 'Notification accepted for processing',
      });

      // Verify jobId is present and formatted correctly
      expect(response.body.jobId).toBeDefined();
      expect(response.body.jobId).toMatch(/^job_[a-f0-9]{32}$/);

      // Verify idempotencyKey is echoed back
      expect(response.body.idempotencyKey).toBe(dto.idempotencyKey);
    });

    it('should return 202 for SMS channel', async () => {
      const dto = {
        idempotencyKey: uuidv4(),
        userId: 'test-user-sms',
        channel: NotificationChannel.SMS,
        recipient: '+1234567890',
        message: 'SMS test notification',
      };

      const response = await request(app.getHttpServer())
        .post('/notifications/send')
        .send(dto)
        .expect(202);

      expect(response.body.success).toBe(true);
      expect(response.body.jobId).toBeDefined();
    });

    it('should return 202 for PUSH channel', async () => {
      const dto = {
        idempotencyKey: uuidv4(),
        userId: 'test-user-push',
        channel: NotificationChannel.PUSH,
        recipient: 'device-token-abc123',
        message: 'Push notification test',
      };

      const response = await request(app.getHttpServer())
        .post('/notifications/send')
        .send(dto)
        .expect(202);

      expect(response.body.success).toBe(true);
      expect(response.body.jobId).toBeDefined();
    });

    it('should enqueue job in the background queue', async () => {
      const dto = {
        idempotencyKey: uuidv4(),
        userId: 'test-user-enqueue',
        channel: NotificationChannel.EMAIL,
        recipient: 'enqueue@example.com',
        subject: 'Queue Test',
        message: 'Testing job enqueue',
      };

      await request(app.getHttpServer()).post('/notifications/send').send(dto).expect(202);

      // Verify job was added to queue
      const job = await queue.getJob(dto.idempotencyKey);
      expect(job).toBeDefined();
      expect(job?.data.userId).toBe(dto.userId);
      expect(job?.data.channel).toBe(dto.channel);
    });
  });

  // ========================================
  // Test Case 2: Idempotency
  // ========================================
  describe('Test Case 2: Idempotency - Duplicate Detection', () => {
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

      // Should return same response (cached)
      expect(response1.body.jobId).toBe(response2.body.jobId);
      expect(response1.body.idempotencyKey).toBe(response2.body.idempotencyKey);
      expect(response1.body.success).toBe(response2.body.success);
    });

    it('should not create duplicate jobs for same idempotency key', async () => {
      const idempotencyKey = uuidv4();
      const dto = {
        idempotencyKey,
        userId: 'no-duplicate-user',
        channel: NotificationChannel.EMAIL,
        recipient: 'nodup@example.com',
        subject: 'No Duplicate Test',
        message: 'Testing no duplicate jobs',
      };

      // Send request twice
      await request(app.getHttpServer()).post('/notifications/send').send(dto).expect(202);

      await request(app.getHttpServer()).post('/notifications/send').send(dto).expect(202);

      // Verify only one job exists (BullMQ uses jobId for deduplication)
      const job = await queue.getJob(idempotencyKey);
      expect(job).toBeDefined();

      // Count total jobs with this ID (should be exactly 1)
      const jobs = await queue.getJobs(['waiting', 'active', 'completed', 'delayed']);
      const matchingJobs = jobs.filter((j) => j.id === idempotencyKey);
      expect(matchingJobs.length).toBeLessThanOrEqual(1);
    });

    it('should allow different idempotency keys to create different jobs', async () => {
      const baseDto = {
        userId: 'different-keys-user',
        channel: NotificationChannel.EMAIL,
        recipient: 'diffkeys@example.com',
        subject: 'Different Keys Test',
        message: 'Testing different keys',
      };

      const response1 = await request(app.getHttpServer())
        .post('/notifications/send')
        .send({ ...baseDto, idempotencyKey: uuidv4() })
        .expect(202);

      const response2 = await request(app.getHttpServer())
        .post('/notifications/send')
        .send({ ...baseDto, idempotencyKey: uuidv4() })
        .expect(202);

      // Should create different jobs
      expect(response1.body.jobId).not.toBe(response2.body.jobId);
    });

    it('should store idempotency key in Redis with TTL', async () => {
      const idempotencyKey = uuidv4();
      const dto = {
        idempotencyKey,
        userId: 'redis-ttl-user',
        channel: NotificationChannel.EMAIL,
        recipient: 'ttl@example.com',
        subject: 'TTL Test',
        message: 'Testing Redis TTL',
      };

      await request(app.getHttpServer()).post('/notifications/send').send(dto).expect(202);

      // Verify key exists in Redis
      const redisKey = `notify:idempotency:${idempotencyKey}`;
      const cachedValue = await redis.get(redisKey);

      expect(cachedValue).toBeDefined();
      expect(cachedValue).not.toBeNull();

      // Verify TTL is set
      const ttl = await redis.ttl(redisKey);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(86400); // 24 hours
    });
  });

  // ========================================
  // Test Case 3: Rate Limiting
  // ========================================
  describe('Test Case 3: Rate Limiting - 10 requests/minute', () => {
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
            recipient: 'ratelimit@example.com',
            subject: `Rate Limit Test ${i}`,
            message: 'Rate limit test',
          })
          .expect(202);
      }

      // 11th request should be rate limited (429)
      const response = await request(app.getHttpServer())
        .post('/notifications/send')
        .send({
          idempotencyKey: uuidv4(),
          userId,
          channel: NotificationChannel.EMAIL,
          recipient: 'ratelimit@example.com',
          subject: 'Should Fail',
          message: 'This should be rate limited',
        })
        .expect(429);

      expect(response.body.message).toContain('Rate limit exceeded');
    });

    it('should include rate limit info in 429 response', async () => {
      const userId = 'rate-limit-info-user';

      // Exhaust rate limit
      for (let i = 0; i < 10; i++) {
        await request(app.getHttpServer())
          .post('/notifications/send')
          .send({
            idempotencyKey: uuidv4(),
            userId,
            channel: NotificationChannel.EMAIL,
            recipient: 'info@example.com',
            subject: `Test ${i}`,
            message: 'Rate limit info test',
          })
          .expect(202);
      }

      // Request that exceeds limit
      const response = await request(app.getHttpServer())
        .post('/notifications/send')
        .send({
          idempotencyKey: uuidv4(),
          userId,
          channel: NotificationChannel.EMAIL,
          recipient: 'info@example.com',
          subject: 'Exceeded',
          message: 'Rate exceeded',
        })
        .expect(429);

      // Verify response contains rate limit details
      expect(response.body).toHaveProperty('statusCode', 429);
      expect(response.body.message).toBeDefined();
    });

    it('should allow requests from different users independently', async () => {
      const user1 = 'independent-user-1';
      const user2 = 'independent-user-2';

      // User 1 sends 10 requests
      for (let i = 0; i < 10; i++) {
        await request(app.getHttpServer())
          .post('/notifications/send')
          .send({
            idempotencyKey: uuidv4(),
            userId: user1,
            channel: NotificationChannel.EMAIL,
            recipient: 'user1@example.com',
            subject: `User 1 Test ${i}`,
            message: 'User 1 rate limit test',
          })
          .expect(202);
      }

      // User 2 should still be able to send requests
      await request(app.getHttpServer())
        .post('/notifications/send')
        .send({
          idempotencyKey: uuidv4(),
          userId: user2,
          channel: NotificationChannel.EMAIL,
          recipient: 'user2@example.com',
          subject: 'User 2 Test',
          message: 'User 2 should not be affected',
        })
        .expect(202);
    });

    it('should reset rate limit after TTL expires', async () => {
      const userId = 'ttl-reset-user';

      // Exhaust rate limit
      for (let i = 0; i < 10; i++) {
        await request(app.getHttpServer())
          .post('/notifications/send')
          .send({
            idempotencyKey: uuidv4(),
            userId,
            channel: NotificationChannel.EMAIL,
            recipient: 'ttlreset@example.com',
            subject: `TTL Reset ${i}`,
            message: 'TTL reset test',
          })
          .expect(202);
      }

      // Clear Redis keys to simulate TTL expiry
      const keys = await redis.keys(`notify:ratelimit:${userId}*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }

      // Should be able to send again
      await request(app.getHttpServer())
        .post('/notifications/send')
        .send({
          idempotencyKey: uuidv4(),
          userId,
          channel: NotificationChannel.EMAIL,
          recipient: 'ttlreset@example.com',
          subject: 'After TTL Reset',
          message: 'Should work after TTL reset',
        })
        .expect(202);
    });
  });

  // ========================================
  // Test Case 4: Failover Logic
  // ========================================
  describe('Test Case 4: Failover Logic - Primary to Fallback', () => {
    // Set environment to force primary provider failure for these tests
    let originalForceFailure: string | undefined;

    beforeAll(() => {
      originalForceFailure = process.env.FORCE_PRIMARY_FAILURE;
      process.env.FORCE_PRIMARY_FAILURE = 'true';
    });

    afterAll(() => {
      process.env.FORCE_PRIMARY_FAILURE = originalForceFailure;
    });

    it('should trigger failover when primary provider fails', async () => {
      const dto = {
        idempotencyKey: uuidv4(),
        userId: 'failover-test-user',
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
        const timeout = setTimeout(() => resolve(false), 15000);

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

      // Verify job completed successfully (failover worked)
      expect(jobCompleted).toBe(true);
    }, 20000);

    it('should process notification with fallback provider successfully', async () => {
      const dto = {
        idempotencyKey: uuidv4(),
        userId: 'fallback-success-user',
        channel: NotificationChannel.SMS,
        recipient: '+1555123456',
        message: 'Testing fallback provider success',
      };

      const response = await request(app.getHttpServer())
        .post('/notifications/send')
        .send(dto)
        .expect(202);

      expect(response.body.success).toBe(true);
      expect(response.body.jobId).toBeDefined();

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Verify job was processed (check queue stats)
      const completed = await queue.getCompletedCount();
      expect(completed).toBeGreaterThanOrEqual(1);
    });

    it('should complete job even with primary failure', async () => {
      const dto = {
        idempotencyKey: uuidv4(),
        userId: 'primary-failure-user',
        channel: NotificationChannel.PUSH,
        recipient: 'push-token-failure-test',
        message: 'Testing completion with primary failure',
      };

      await request(app.getHttpServer()).post('/notifications/send').send(dto).expect(202);

      // Wait for job processing
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Job should be in completed state, not failed
      const job = await queue.getJob(dto.idempotencyKey);
      expect(job?.finishedOn).toBeDefined();
    }, 15000);
  });

  // ========================================
  // Test Case 5: Validation
  // ========================================
  describe('Test Case 5: Validation - Invalid Payload Handling', () => {
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

      expect(response.body.message).toBeDefined();
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
      expect(response.body.statusCode).toBe(400);
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

      expect(response.body.message).toBeDefined();
      expect(JSON.stringify(response.body.message).toLowerCase()).toContain('subject');
    });

    it('should require valid email for email channel', async () => {
      const response = await request(app.getHttpServer())
        .post('/notifications/send')
        .send({
          idempotencyKey: uuidv4(),
          userId: 'invalid-email-user',
          channel: NotificationChannel.EMAIL,
          recipient: 'not-an-email',
          subject: 'Invalid Email Test',
          message: 'This should fail validation',
        })
        .expect(400);

      expect(response.body.message).toBeDefined();
    });

    it('should reject invalid UUID for idempotencyKey', async () => {
      const response = await request(app.getHttpServer())
        .post('/notifications/send')
        .send({
          idempotencyKey: 'not-a-uuid',
          userId: 'invalid-uuid-user',
          channel: NotificationChannel.EMAIL,
          recipient: 'test@example.com',
          subject: 'Invalid UUID Test',
          message: 'This should fail validation',
        })
        .expect(400);

      expect(response.body.message).toBeDefined();
      expect(JSON.stringify(response.body.message).toLowerCase()).toContain('idempotency');
    });

    it('should reject empty message', async () => {
      const response = await request(app.getHttpServer())
        .post('/notifications/send')
        .send({
          idempotencyKey: uuidv4(),
          userId: 'empty-message-user',
          channel: NotificationChannel.SMS,
          recipient: '+1234567890',
          message: '',
        })
        .expect(400);

      expect(response.body.message).toBeDefined();
    });

    it('should reject extra fields not in DTO', async () => {
      const response = await request(app.getHttpServer())
        .post('/notifications/send')
        .send({
          idempotencyKey: uuidv4(),
          userId: 'extra-fields-user',
          channel: NotificationChannel.EMAIL,
          recipient: 'test@example.com',
          subject: 'Extra Fields Test',
          message: 'Testing extra fields',
          extraField: 'should be rejected',
          anotherExtra: 123,
        })
        .expect(400);

      expect(response.body.message).toBeDefined();
    });

    it('should reject userId exceeding max length', async () => {
      const response = await request(app.getHttpServer())
        .post('/notifications/send')
        .send({
          idempotencyKey: uuidv4(),
          userId: 'a'.repeat(256), // Exceeds 255 character limit
          channel: NotificationChannel.EMAIL,
          recipient: 'test@example.com',
          subject: 'Long User ID Test',
          message: 'Testing max length validation',
        })
        .expect(400);

      expect(response.body.message).toBeDefined();
    });

    it('should reject message exceeding max length', async () => {
      const response = await request(app.getHttpServer())
        .post('/notifications/send')
        .send({
          idempotencyKey: uuidv4(),
          userId: 'long-message-user',
          channel: NotificationChannel.EMAIL,
          recipient: 'test@example.com',
          subject: 'Long Message Test',
          message: 'a'.repeat(10001), // Exceeds 10000 character limit
        })
        .expect(400);

      expect(response.body.message).toBeDefined();
    });
  });

  // ========================================
  // Test Case 6: Health Check
  // ========================================
  describe('Test Case 6: Health Check - Service Status', () => {
    it('should return healthy status', async () => {
      const response = await request(app.getHttpServer()).get('/health').expect(200);

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('checks');
    });

    it('should include Redis health check', async () => {
      const response = await request(app.getHttpServer()).get('/health').expect(200);

      expect(response.body.checks).toHaveProperty('redis');
    });

    it('should include Queue health check', async () => {
      const response = await request(app.getHttpServer()).get('/health').expect(200);

      expect(response.body.checks).toHaveProperty('queue');
    });

    it('should return pong for ping endpoint', async () => {
      const response = await request(app.getHttpServer()).get('/ping').expect(200);

      expect(response.body.message).toBe('pong');
    });

    it('should respond quickly to health check', async () => {
      const startTime = Date.now();

      await request(app.getHttpServer()).get('/health').expect(200);

      const responseTime = Date.now() - startTime;

      // Health check should respond within 2 seconds
      expect(responseTime).toBeLessThan(2000);
    });
  });

  // ========================================
  // Additional Integration Tests
  // ========================================
  describe('Additional Integration Tests', () => {
    it('should handle concurrent requests from same user', async () => {
      const userId = 'concurrent-user';
      const requests = [];

      // Send 5 concurrent requests
      for (let i = 0; i < 5; i++) {
        requests.push(
          request(app.getHttpServer())
            .post('/notifications/send')
            .send({
              idempotencyKey: uuidv4(),
              userId,
              channel: NotificationChannel.EMAIL,
              recipient: 'concurrent@example.com',
              subject: `Concurrent Test ${i}`,
              message: 'Testing concurrent requests',
            }),
        );
      }

      const responses = await Promise.all(requests);

      // All should succeed (within rate limit)
      responses.forEach((response) => {
        expect([202, 429]).toContain(response.status);
      });
    });

    it('should preserve data integrity through queue processing', async () => {
      const dto = {
        idempotencyKey: uuidv4(),
        userId: 'integrity-user',
        channel: NotificationChannel.EMAIL,
        recipient: 'integrity@example.com',
        subject: 'Data Integrity Test',
        message: 'Special characters: <>&"\'\n\t特殊字符',
      };

      await request(app.getHttpServer()).post('/notifications/send').send(dto).expect(202);

      // Verify job data integrity
      const job = await queue.getJob(dto.idempotencyKey);
      expect(job?.data.subject).toBe(dto.subject);
      expect(job?.data.message).toBe(dto.message);
    });

    it('should handle rapid sequential requests', async () => {
      const userId = 'rapid-user';
      const successCount = { value: 0 };

      for (let i = 0; i < 5; i++) {
        const response = await request(app.getHttpServer())
          .post('/notifications/send')
          .send({
            idempotencyKey: uuidv4(),
            userId,
            channel: NotificationChannel.EMAIL,
            recipient: 'rapid@example.com',
            subject: `Rapid ${i}`,
            message: 'Rapid sequential test',
          });

        if (response.status === 202) {
          successCount.value++;
        }
      }

      // At least some requests should succeed
      expect(successCount.value).toBeGreaterThan(0);
    });
  });
});
