import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { NotificationService } from './services/notification.service';
import { IdempotencyService } from './services/idempotency.service';
import { RateLimitService } from './services/rate-limit.service';
import { RateLimitExceededException, DuplicateRequestException } from '../common/exceptions';
import { StructuredLoggerService } from '../common/services/logger.service';
import {
  SendNotificationDto,
  SendNotificationResponseDto,
  ErrorResponseDto,
} from './dto/notification.dto';

/**
 * Notifications Controller
 *
 * Handles all notification-related HTTP endpoints.
 * Implements rate limiting, idempotency, and async processing.
 */
@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly idempotencyService: IdempotencyService,
    private readonly rateLimitService: RateLimitService,
    private readonly logger: StructuredLoggerService,
  ) {}

  /**
   * Send Notification Endpoint
   *
   * Accepts a notification request and queues it for background processing.
   * Returns HTTP 202 Accepted immediately after validation and enqueueing.
   *
   * Features:
   * - Per-user rate limiting (10 requests/minute)
   * - Idempotency via client-provided key
   * - Immediate async response
   * - Background processing with failover
   */
  @Post('send')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Send a notification' })
  @ApiBody({ type: SendNotificationDto })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Notification accepted for processing',
    type: SendNotificationResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description: 'Rate limit exceeded',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid request payload',
    type: ErrorResponseDto,
  })
  async sendNotification(@Body() dto: SendNotificationDto): Promise<SendNotificationResponseDto> {
    // 1. Check rate limit first
    const rateLimitResult = await this.rateLimitService.checkRateLimit(dto.userId);

    if (!rateLimitResult.allowed) {
      this.logger.logRateLimitExceeded(
        dto.userId,
        rateLimitResult.currentCount,
        rateLimitResult.limit,
      );

      throw new RateLimitExceededException(
        rateLimitResult.resetIn,
        rateLimitResult.currentCount,
        rateLimitResult.limit,
      );
    }

    // 2. Check idempotency
    try {
      await this.idempotencyService.checkAndLock(dto.idempotencyKey, dto.userId);
    } catch (error) {
      if (error instanceof DuplicateRequestException) {
        // Return cached response for duplicate requests
        const cached = error.cachedResponse;
        return cached.body as SendNotificationResponseDto;
      }
      throw error;
    }

    // 3. Record the request for rate limiting
    await this.rateLimitService.recordRequest(dto.userId);

    // 4. Enqueue the notification
    const response = await this.notificationService.enqueueNotification(dto);

    // 5. Store the response for idempotency
    await this.idempotencyService.storeResponse(dto.idempotencyKey, HttpStatus.ACCEPTED, response);

    return response;
  }
}
