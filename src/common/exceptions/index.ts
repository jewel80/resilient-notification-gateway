import { HttpException, HttpStatus } from '@nestjs/common';
import { CachedIdempotencyResult } from '../interfaces';

/**
 * Provider Error Exception
 *
 * Thrown when a notification provider fails to send a message.
 * Contains provider-specific information for logging and failover decisions.
 */
export class ProviderException extends HttpException {
  /** Name of the provider that failed */
  public readonly providerName: string;

  /** Whether this error is retryable with another provider */
  public readonly isRetryable: boolean;

  /** Original error if available */
  public readonly originalError?: Error;

  constructor(
    providerName: string,
    message: string,
    isRetryable: boolean = true,
    originalError?: Error,
  ) {
    super(
      {
        statusCode: HttpStatus.BAD_GATEWAY,
        message: `Provider ${providerName} failed: ${message}`,
        error: 'Provider Error',
        providerName,
        isRetryable,
      },
      HttpStatus.BAD_GATEWAY,
    );
    this.providerName = providerName;
    this.isRetryable = isRetryable;
    this.originalError = originalError;
  }
}

/**
 * Rate Limit Exceeded Exception
 *
 * Thrown when a user exceeds their allowed request rate.
 * Returns HTTP 429 with retry information.
 */
export class RateLimitExceededException extends HttpException {
  /** Seconds until the rate limit resets */
  public readonly retryAfter: number;

  /** Current request count */
  public readonly currentCount: number;

  /** Maximum allowed requests */
  public readonly limit: number;

  constructor(retryAfter: number, currentCount: number, limit: number) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: `Rate limit exceeded. Limit: ${limit} requests per minute.`,
        error: 'Too Many Requests',
        retryAfter,
        currentCount,
        limit,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
    this.retryAfter = retryAfter;
    this.currentCount = currentCount;
    this.limit = limit;
  }
}

/**
 * Duplicate Request Exception
 *
 * Internal exception to signal that a request was deduplicated.
 * This is caught by the controller to return the cached response.
 */
export class DuplicateRequestException extends Error {
  /** The cached response to return */
  public readonly cachedResponse: CachedIdempotencyResult;

  constructor(cachedResponse: CachedIdempotencyResult) {
    super('Duplicate request detected');
    this.name = 'DuplicateRequestException';
    this.cachedResponse = cachedResponse;
  }
}

/**
 * All Providers Failed Exception
 *
 * Thrown when all available providers for a channel have failed.
 */
export class AllProvidersFailedException extends HttpException {
  /** Channel that failed */
  public readonly channel: string;

  /** List of providers that were attempted */
  public readonly attemptedProviders: string[];

  constructor(channel: string, attemptedProviders: string[]) {
    super(
      {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: `All providers failed for channel: ${channel}`,
        error: 'Service Unavailable',
        channel,
        attemptedProviders,
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
    this.channel = channel;
    this.attemptedProviders = attemptedProviders;
  }
}
