import { Module, Global, OnModuleDestroy, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { QueueNames, Defaults } from '../common/constants';
import { NotificationJobData, NotificationJobResult } from '../common/interfaces';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import { StructuredLoggerService } from '../common/services/logger.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { ProvidersModule } from '../providers/providers.module';
import { AllProvidersFailedException } from '../common/exceptions';
import Redis from 'ioredis';

/**
 * Notification Queue Token
 *
 * Injection token for the BullMQ notification queue.
 */
export const NOTIFICATION_QUEUE = 'NOTIFICATION_QUEUE';

/**
 * Queue Factory
 *
 * Creates the BullMQ queue instance for notification processing.
 */
export const queueFactory = {
  provide: NOTIFICATION_QUEUE,
  useFactory: (configService: ConfigService): Queue<NotificationJobData> => {
    const host = configService.get<string>('REDIS_HOST', 'localhost');
    const port = configService.get<number>('REDIS_PORT', 6379);

    return new Queue<NotificationJobData>(QueueNames.NOTIFICATIONS, {
      connection: { host, port },
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: {
          age: 3600,
          count: 1000,
        },
        removeOnFail: {
          age: 86400,
        },
      },
    });
  },
  inject: [ConfigService],
};

/**
 * Queue Worker Factory
 *
 * Creates the BullMQ worker that processes notification jobs.
 */
export const queueWorkerFactory = {
  provide: 'QUEUE_WORKER',
  useFactory: (
    configService: ConfigService,
    providerRegistry: ProviderRegistryService,
    logger: StructuredLoggerService,
    redis: Redis,
  ) => {
    const host = configService.get<string>('REDIS_HOST', 'localhost');
    const port = configService.get<number>('REDIS_PORT', 6379);
    const concurrency = Math.max(
      1,
      configService.get<number>('QUEUE_CONCURRENCY', Defaults.QUEUE_CONCURRENCY) ||
        Defaults.QUEUE_CONCURRENCY,
    );

    const worker = new Worker<NotificationJobData>(
      QueueNames.NOTIFICATIONS,
      async (job) => {
        const startTime = Date.now();
        const { data } = job;
        const { jobId, userId, channel, recipient, subject, message, idempotencyKey } = data;

        logger.logJobProcessing(jobId, channel);

        try {
          // Attempt to send with failover
          const { response, providerUsed } = await providerRegistry.sendWithFailover(
            channel,
            {
              userId,
              recipient,
              subject,
              message,
            },
            jobId,
          );

          const duration = Date.now() - startTime;

          logger.logJobSuccess(jobId, providerUsed, channel, response.messageId, duration);

          // Store the result for idempotency
          const result: NotificationJobResult = {
            success: true,
            providerUsed,
            messageId: response.messageId,
            completedAt: new Date(),
          };

          // Update idempotency cache with final result
          const idempotencyKeyRedis = `notify:idempotency:${idempotencyKey}`;
          await redis.set(
            idempotencyKeyRedis,
            JSON.stringify({
              statusCode: 202,
              body: {
                success: true,
                jobId,
                message: 'Notification sent successfully',
                result,
              },
              cachedAt: Date.now(),
            }),
            'EX',
            86400,
          );

          return result;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const providersAttempted =
            error instanceof AllProvidersFailedException ? error.attemptedProviders : [];

          logger.logJobFailed(jobId, channel, errorMessage, providersAttempted);

          // Store the failure result for idempotency
          const idempotencyKeyRedis = `notify:idempotency:${idempotencyKey}`;
          await redis.set(
            idempotencyKeyRedis,
            JSON.stringify({
              statusCode: 202,
              body: {
                success: false,
                jobId,
                message: 'Notification processing failed',
                error: errorMessage,
              },
              cachedAt: Date.now(),
            }),
            'EX',
            86400,
          );

          throw error;
        }
      },
      {
        connection: { host, port },
        concurrency,
      },
    );

    // Worker event handlers
    worker.on('completed', (job) => {
      logger.debug(`Job ${job.id} completed`, 'QueueWorker');
    });

    worker.on('failed', (job, err) => {
      logger.error(`Job ${job?.id} failed: ${err.message}`, err.stack, 'QueueWorker');
    });

    worker.on('error', (err) => {
      logger.error('Worker error', err.message, 'QueueWorker');
    });

    return worker;
  },
  inject: [ConfigService, ProviderRegistryService, StructuredLoggerService, REDIS_CLIENT],
};

/**
 * Queue Module
 *
 * Configures BullMQ for background notification processing.
 * Provides the queue for enqueuing jobs and the worker for processing them.
 */
@Global()
@Module({
  imports: [ProvidersModule],
  providers: [queueFactory, queueWorkerFactory, StructuredLoggerService],
  exports: [NOTIFICATION_QUEUE],
})
export class QueueModule implements OnModuleDestroy {
  private worker: Worker | null = null;

  constructor(
    private readonly configService: ConfigService,
    @Inject('QUEUE_WORKER') worker: Worker,
  ) {
    this.worker = worker;
  }

  async onModuleDestroy(): Promise<void> {
    // Gracefully close the worker on module destroy
    if (this.worker) {
      await this.worker.close();
    }
  }
}
