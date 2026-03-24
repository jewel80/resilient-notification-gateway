import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationService } from './services/notification.service';
import { IdempotencyService } from './services/idempotency.service';
import { RateLimitService } from './services/rate-limit.service';
import { ProvidersModule } from '../providers/providers.module';
import { QueueModule } from '../queue/queue.module';
import { StructuredLoggerService } from '../common/services/logger.service';

/**
 * Notifications Module
 *
 * Core module for notification handling including:
 * - REST API controller
 * - Business logic services
 * - Rate limiting and idempotency
 * - Provider integration
 */
@Module({
  imports: [ProvidersModule, QueueModule],
  controllers: [NotificationsController],
  providers: [NotificationService, IdempotencyService, RateLimitService, StructuredLoggerService],
  exports: [NotificationService, IdempotencyService, RateLimitService],
})
export class NotificationsModule {}
