import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { NotificationChannel } from '../../common/constants';
import { NotificationJobData } from '../../common/interfaces';
import { StructuredLoggerService } from '../../common/services/logger.service';
import { NOTIFICATION_QUEUE } from '../../queue/queue.module';
import { SendNotificationDto, SendNotificationResponseDto } from '../dto/notification.dto';

/**
 * Notification Service
 *
 * Core business logic for notification handling.
 * Orchestrates idempotency checks, rate limiting, and job enqueueing.
 */
@Injectable()
export class NotificationService {
  constructor(
    @Inject(NOTIFICATION_QUEUE) private readonly notificationQueue: Queue<NotificationJobData>,
    private readonly logger: StructuredLoggerService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Enqueues a notification for background processing
   *
   * Creates a job in the BullMQ queue and returns immediately (HTTP 202).
   * The actual notification sending happens asynchronously in the queue worker.
   *
   * @param dto - Validated notification request
   * @returns Response with job ID indicating acceptance
   */
  async enqueueNotification(dto: SendNotificationDto): Promise<SendNotificationResponseDto> {
    const jobId = this.generateJobId();

    const jobData: NotificationJobData = {
      jobId,
      idempotencyKey: dto.idempotencyKey,
      userId: dto.userId,
      channel: dto.channel as NotificationChannel,
      recipient: dto.recipient,
      subject: dto.subject,
      message: dto.message,
      createdAt: new Date(),
      retryCount: 0,
    };

    // Add job to the queue
    // Use idempotency key as job ID for queue-level deduplication
    await this.notificationQueue.add('send-notification', jobData, {
      jobId: dto.idempotencyKey,
    });

    // Log the enqueue event
    this.logger.logJobEnqueued(jobId, dto.userId, dto.channel, dto.idempotencyKey);

    return {
      success: true,
      jobId,
      statusCode: 202,
      message: 'Notification accepted for processing',
      idempotencyKey: dto.idempotencyKey,
    };
  }

  /**
   * Generates a unique job identifier
   */
  private generateJobId(): string {
    return `job_${uuidv4().replace(/-/g, '')}`;
  }
}
