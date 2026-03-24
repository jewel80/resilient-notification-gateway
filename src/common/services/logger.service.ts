import { Injectable, LoggerService } from '@nestjs/common';

/**
 * Log Context Interface
 *
 * Structured context data included in every log entry.
 */
interface LogContext {
  timestamp: string;
  level: string;
  context: string;
  correlationId?: string;
  userId?: string;
  jobId?: string;
  channel?: string;
  provider?: string;
  duration?: number;
  [key: string]: unknown;
}

/**
 * Structured Logger Service
 *
 * Provides JSON-formatted logging for production observability.
 * All logs include structured context for easy parsing and analysis.
 *
 * Log levels:
 * - error: System failures requiring attention
 * - warn: Potential issues that don't block operation
 * - log: Important business events
 * - debug: Detailed information for troubleshooting
 * - verbose: Fine-grained debug information
 */
@Injectable()
export class StructuredLoggerService implements LoggerService {
  /**
   * Formats a log entry as JSON
   *
   * @param level - Log level
   * @param context - Logger context/module name
   * @param message - Log message
   * @param meta - Additional metadata
   * @returns Formatted JSON string
   */
  private formatLog(
    level: string,
    context: string,
    message: string,
    meta?: Record<string, unknown>,
  ): string {
    const logEntry: LogContext = {
      timestamp: new Date().toISOString(),
      level,
      context,
      ...meta,
    };

    return JSON.stringify({ ...logEntry, message });
  }

  /**
   * Log an error message
   *
   * Use for system failures and exceptions that require attention.
   */
  error(message: string, trace?: string, context?: string, meta?: Record<string, unknown>): void {
    const formattedLog = this.formatLog('error', context || 'Application', message, {
      ...meta,
      trace,
    });
    console.error(formattedLog);
  }

  /**
   * Log a warning message
   *
   * Use for potential issues that don't block operation but may need attention.
   */
  warn(message: string, context?: string, meta?: Record<string, unknown>): void {
    const formattedLog = this.formatLog('warn', context || 'Application', message, meta);
    console.warn(formattedLog);
  }

  /**
   * Log an informational message
   *
   * Use for important business events and state changes.
   */
  log(message: string, context?: string, meta?: Record<string, unknown>): void {
    const formattedLog = this.formatLog('info', context || 'Application', message, meta);
    console.log(formattedLog);
  }

  /**
   * Log a debug message
   *
   * Use for detailed information useful during development and troubleshooting.
   */
  debug(message: string, context?: string, meta?: Record<string, unknown>): void {
    if (process.env.NODE_ENV !== 'production') {
      const formattedLog = this.formatLog('debug', context || 'Application', message, meta);
      console.debug(formattedLog);
    }
  }

  /**
   * Log a verbose message
   *
   * Use for fine-grained debug information in development.
   */
  verbose(message: string, context?: string, meta?: Record<string, unknown>): void {
    if (process.env.NODE_ENV === 'development') {
      const formattedLog = this.formatLog('verbose', context || 'Application', message, meta);
      console.debug(formattedLog);
    }
  }

  // Convenience methods for common log events

  /**
   * Log when a notification job is enqueued
   */
  logJobEnqueued(jobId: string, userId: string, channel: string, idempotencyKey: string): void {
    this.log('Job enqueued for processing', 'QueueService', {
      jobId,
      userId,
      channel,
      idempotencyKey,
      event: 'job_enqueued',
    });
  }

  /**
   * Log when job processing starts
   */
  logJobProcessing(jobId: string, channel: string): void {
    this.log('Job processing started', 'QueueProcessor', {
      jobId,
      channel,
      event: 'job_processing',
    });
  }

  /**
   * Log provider attempt
   */
  logProviderAttempt(jobId: string, provider: string, channel: string): void {
    this.debug('Provider attempt', 'ProviderService', {
      jobId,
      provider,
      channel,
      event: 'provider_attempt',
    });
  }

  /**
   * Log provider failure
   */
  logProviderFailed(jobId: string, provider: string, channel: string, error: string): void {
    this.warn('Provider failed, attempting failover', 'ProviderService', {
      jobId,
      provider,
      channel,
      error,
      event: 'provider_failed',
    });
  }

  /**
   * Log failover triggered
   */
  logFailoverTriggered(
    jobId: string,
    fromProvider: string,
    toProvider: string,
    channel: string,
  ): void {
    this.log('Failover triggered to secondary provider', 'ProviderService', {
      jobId,
      fromProvider,
      toProvider,
      channel,
      event: 'failover_triggered',
    });
  }

  /**
   * Log job success
   */
  logJobSuccess(
    jobId: string,
    provider: string,
    channel: string,
    messageId?: string,
    duration?: number,
  ): void {
    this.log('Job completed successfully', 'QueueProcessor', {
      jobId,
      provider,
      channel,
      messageId,
      duration,
      event: 'job_succeeded',
    });
  }

  /**
   * Log job failure
   */
  logJobFailed(jobId: string, channel: string, error: string, providersAttempted: string[]): void {
    this.error('Job failed after all provider attempts', undefined, 'QueueProcessor', {
      jobId,
      channel,
      error,
      providersAttempted,
      event: 'job_failed',
    });
  }

  /**
   * Log duplicate request detected
   */
  logDuplicateDetected(idempotencyKey: string, userId: string): void {
    this.log('Duplicate request detected, returning cached response', 'IdempotencyService', {
      idempotencyKey,
      userId,
      event: 'duplicate_detected',
    });
  }

  /**
   * Log rate limit exceeded
   */
  logRateLimitExceeded(userId: string, currentCount: number, limit: number): void {
    this.warn('Rate limit exceeded', 'RateLimitGuard', {
      userId,
      currentCount,
      limit,
      event: 'rate_limit_exceeded',
    });
  }
}
