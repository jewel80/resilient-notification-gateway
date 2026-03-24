/**
 * Notification Channel Enumeration
 *
 * Defines the supported notification delivery channels.
 * Each channel has dedicated providers with failover capabilities.
 */
export enum NotificationChannel {
  EMAIL = 'email',
  SMS = 'sms',
  PUSH = 'push',
}

/**
 * Notification Job Status Enumeration
 *
 * Tracks the lifecycle state of notification jobs through the queue.
 */
export enum JobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  RETRYING = 'retrying',
}

/**
 * Provider Status Enumeration
 *
 * Indicates the current health state of notification providers.
 */
export enum ProviderStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNHEALTHY = 'unhealthy',
}

/**
 * Redis Key Prefixes
 *
 * Centralized constants for Redis key naming conventions.
 */
export const RedisKeyPrefix = {
  RATE_LIMIT: 'notify:ratelimit',
  IDEMPOTENCY: 'notify:idempotency',
  LOCK: 'notify:lock',
} as const;

/**
 * Queue Names
 *
 * Defines the BullMQ queue identifiers for job processing.
 */
export const QueueNames = {
  NOTIFICATIONS: 'notifications',
} as const;

/**
 * Default Configuration Values
 *
 * Fallback values used when environment variables are not set.
 */
export const Defaults = {
  RATE_LIMIT_PER_MINUTE: 10,
  IDEMPOTENCY_TTL_SECONDS: 86400, // 24 hours
  QUEUE_CONCURRENCY: 5,
  PROVIDER_TIMEOUT_MS: 5000,
  MAX_RETRY_ATTEMPTS: 3,
  RETRY_DELAY_MS: 1000,
} as const;
