/**
 * Root Application Module
 *
 * Assembles all feature modules and configures global dependencies including:
 * - Configuration management via @nestjs/config
 * - Redis connection module
 * - Queue module for BullMQ integration
 * - Notification module with providers and controllers
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from './redis/redis.module';
import { QueueModule } from './queue/queue.module';
import { NotificationsModule } from './notifications/notifications.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    // Load environment configuration globally
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),

    // Redis connection for caching and queue backing
    RedisModule,

    // BullMQ queue for background job processing
    QueueModule,

    // Notification handling with providers and failover
    NotificationsModule,

    // Health check endpoints
    HealthModule,
  ],
})
export class AppModule {}
