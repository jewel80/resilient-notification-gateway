import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { StructuredLoggerService } from '../common/services/logger.service';

/**
 * Redis Client Factory Symbol
 *
 * Used for dependency injection of the Redis client instance.
 */
export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * Redis Client Factory
 *
 * Creates and configures the Redis client connection with error handling
 * and connection logging.
 *
 * @param configService - NestJS config service for environment variables
 * @param logger - Structured logger for connection events
 * @returns Configured Redis client instance
 */
export const redisClientFactory = {
  provide: REDIS_CLIENT,
  useFactory: (configService: ConfigService, logger: StructuredLoggerService): Redis => {
    const host = configService.get<string>('REDIS_HOST', 'localhost');
    const port = configService.get<number>('REDIS_PORT', 6379);

    const client = new Redis({
      host,
      port,
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => {
        if (times > 3) {
          logger.error('Redis connection failed after 3 retries', undefined, 'RedisModule');
          return null;
        }
        return Math.min(times * 100, 3000);
      },
      enableReadyCheck: true,
      lazyConnect: false,
    });

    client.on('connect', () => {
      logger.log('Redis connection established', 'RedisModule', { host, port });
    });

    client.on('error', (error) => {
      logger.error('Redis connection error', error.message, 'RedisModule', {
        error: error.message,
        host,
        port,
      });
    });

    client.on('close', () => {
      logger.warn('Redis connection closed', 'RedisModule', { host, port });
    });

    client.on('reconnecting', () => {
      logger.log('Redis reconnecting...', 'RedisModule', { host, port });
    });

    return client;
  },
  inject: [ConfigService, StructuredLoggerService],
};

/**
 * Global Redis Module
 *
 * Provides a singleton Redis client instance available across all modules.
 * Uses ioredis for robust Redis connectivity with automatic reconnection.
 */
@Global()
@Module({
  providers: [redisClientFactory, StructuredLoggerService],
  exports: [REDIS_CLIENT, StructuredLoggerService],
})
export class RedisModule {}
