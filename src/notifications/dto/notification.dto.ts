import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsEnum,
  IsEmail,
  IsNotEmpty,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { NotificationChannel } from '../../common/constants';

/**
 * Send Notification Request DTO
 *
 * Validates and transports the notification send request payload.
 * All fields are validated before the request is processed.
 */
export class SendNotificationDto {
  @ApiProperty({
    description: 'Client-generated unique key for idempotency',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID('4', { message: 'Idempotency key must be a valid UUID v4' })
  @IsNotEmpty({ message: 'Idempotency key is required' })
  idempotencyKey: string;

  @ApiProperty({
    description: 'Unique identifier of the user making the request',
    example: 'user_123456',
  })
  @IsString({ message: 'User ID must be a string' })
  @IsNotEmpty({ message: 'User ID is required' })
  @MaxLength(255, { message: 'User ID must not exceed 255 characters' })
  userId: string;

  @ApiProperty({
    description: 'Notification delivery channel',
    enum: NotificationChannel,
    example: NotificationChannel.EMAIL,
  })
  @IsEnum(NotificationChannel, {
    message: 'Channel must be one of: email, sms, push',
  })
  channel: NotificationChannel;

  @ApiProperty({
    description:
      'Recipient address (email for email channel, phone for SMS, device token for push)',
    example: 'user@example.com',
  })
  @IsString({ message: 'Recipient must be a string' })
  @IsNotEmpty({ message: 'Recipient is required' })
  @MaxLength(500, { message: 'Recipient must not exceed 500 characters' })
  @ValidateIf((o) => o.channel === NotificationChannel.EMAIL)
  @IsEmail({}, { message: 'Recipient must be a valid email address for email channel' })
  recipient: string;

  @ApiPropertyOptional({
    description: 'Subject line (required for email channel)',
    example: 'Welcome to Our Service',
  })
  @ValidateIf((o) => o.channel === NotificationChannel.EMAIL)
  @IsString({ message: 'Subject must be a string' })
  @IsNotEmpty({ message: 'Subject is required for email channel' })
  @MaxLength(200, { message: 'Subject must not exceed 200 characters' })
  subject?: string;

  @ApiProperty({
    description: 'Notification message content',
    example: 'Your verification code is 123456',
  })
  @IsString({ message: 'Message must be a string' })
  @IsNotEmpty({ message: 'Message is required' })
  @MaxLength(10000, { message: 'Message must not exceed 10000 characters' })
  message: string;
}

/**
 * Send Notification Response DTO
 *
 * Returned after a notification request is accepted for processing.
 */
export class SendNotificationResponseDto {
  @ApiProperty({
    description: 'Indicates the request was accepted for processing',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: 'Unique job identifier for tracking',
    example: 'job_abc123',
  })
  jobId: string;

  @ApiProperty({
    description: 'HTTP status code',
    example: 202,
  })
  statusCode: number;

  @ApiProperty({
    description: 'Response message',
    example: 'Notification accepted for processing',
  })
  message: string;

  @ApiPropertyOptional({
    description: 'The idempotency key from the request',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  idempotencyKey?: string;
}

/**
 * Error Response DTO
 *
 * Standard error response structure for API errors.
 */
export class ErrorResponseDto {
  @ApiProperty({
    description: 'HTTP status code',
    example: 400,
  })
  statusCode: number;

  @ApiProperty({
    description: 'Error message',
    example: 'Validation failed',
  })
  message: string;

  @ApiProperty({
    description: 'Error type',
    example: 'Bad Request',
  })
  error: string;

  @ApiPropertyOptional({
    description: 'Additional error details',
  })
  details?: Record<string, unknown>;
}
