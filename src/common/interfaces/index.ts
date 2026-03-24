import { NotificationChannel } from '../constants';

/**
 * Notification Provider Interface
 *
 * Defines the contract for all notification provider implementations.
 * Each channel (email, SMS, push) must have providers implementing this interface.
 */
export interface INotificationProvider {
  /** Unique identifier for the provider instance */
  readonly name: string;

  /** The channel this provider handles */
  readonly channel: NotificationChannel;

  /** Priority order for provider selection (lower = higher priority) */
  readonly priority: number;

  /**
   * Sends a notification through this provider
   *
   * @param payload - The notification payload to send
   * @returns Promise resolving to provider response
   * @throws ProviderError if the send operation fails
   */
  send(payload: NotificationPayload): Promise<ProviderResponse>;
}

/**
 * Notification Payload Interface
 *
 * Standardized structure for notification data passed to providers.
 */
export interface NotificationPayload {
  /** Target user identifier */
  userId: string;

  /** Recipient address (email, phone number, device token) */
  recipient: string;

  /** Notification subject (optional, channel-specific) */
  subject?: string;

  /** Message content */
  message: string;

  /** Additional metadata for the notification */
  metadata?: Record<string, unknown>;
}

/**
 * Provider Response Interface
 *
 * Standardized response from provider send operations.
 */
export interface ProviderResponse {
  /** Whether the send operation was successful */
  success: boolean;

  /** Provider-specific message ID for tracking */
  messageId?: string;

  /** Additional provider response data */
  data?: Record<string, unknown>;
}

/**
 * Notification Job Data Interface
 *
 * Structure of jobs enqueued in BullMQ for background processing.
 */
export interface NotificationJobData {
  /** Unique job identifier */
  jobId: string;

  /** Client-provided idempotency key */
  idempotencyKey: string;

  /** Target user identifier */
  userId: string;

  /** Notification channel */
  channel: NotificationChannel;

  /** Recipient address */
  recipient: string;

  /** Subject line (for email) */
  subject?: string;

  /** Message content */
  message: string;

  /** Additional metadata */
  metadata?: Record<string, unknown>;

  /** Timestamp when job was created */
  createdAt: Date;

  /** Number of retry attempts made */
  retryCount: number;
}

/**
 * Notification Job Result Interface
 *
 * Structure of results stored after job completion.
 */
export interface NotificationJobResult {
  /** Whether the notification was sent successfully */
  success: boolean;

  /** Provider that handled the notification */
  providerUsed: string;

  /** Message ID from the provider */
  messageId?: string;

  /** Timestamp of completion */
  completedAt: Date;

  /** Error message if failed */
  error?: string;
}

/**
 * Cached Idempotency Result Interface
 *
 * Stored response for deduplicated requests.
 */
export interface CachedIdempotencyResult {
  /** Original response status code */
  statusCode: number;

  /** Original response body */
  body: unknown;

  /** Timestamp when the result was cached */
  cachedAt: number;
}

/**
 * Rate Limit Check Result Interface
 *
 * Result of rate limit validation.
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;

  /** Current request count in the window */
  currentCount: number;

  /** Maximum allowed requests */
  limit: number;

  /** Seconds until the rate limit resets */
  resetIn: number;
}
