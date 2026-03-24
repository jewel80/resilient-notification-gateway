import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisKeyPrefix, Defaults } from '../../common/constants';
import { CachedIdempotencyResult } from '../../common/interfaces';
import { DuplicateRequestException } from '../../common/exceptions';
import { StructuredLoggerService } from '../../common/services/logger.service';
import { REDIS_CLIENT } from '../../redis/redis.module';

/**
 * Idempotency Service
 *
 * Implements request deduplication using Redis.
 * Stores idempotency keys with cached responses to prevent duplicate processing.
 *
 * TTL ensures old keys are automatically cleaned up.
 */
@Injectable()
export class IdempotencyService {
  private readonly ttlSeconds: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly configService: ConfigService,
    private readonly logger: StructuredLoggerService,
  ) {
    this.ttlSeconds = this.configService.get<number>(
      'IDEMPOTENCY_TTL',
      Defaults.IDEMPOTENCY_TTL_SECONDS,
    );
  }

  /**
   * Checks if a request with the given idempotency key has already been processed
   *
   * If a cached result exists, throws DuplicateRequestException with the cached response.
   * Otherwise, allows the request to proceed.
   *
   * @param idempotencyKey - Client-provided unique key
   * @param userId - User ID for logging context
   * @throws DuplicateRequestException if request was already processed
   */
  async checkAndLock(idempotencyKey: string, userId: string): Promise<void> {
    const key = this.getKey(idempotencyKey);
    const cached = await this.redis.get(key);

    if (cached) {
      // Request was already processed - log and throw
      this.logger.logDuplicateDetected(idempotencyKey, userId);

      const cachedResult: CachedIdempotencyResult = JSON.parse(cached);
      throw new DuplicateRequestException(cachedResult);
    }

    // Set a temporary lock to prevent race conditions
    // This is a lightweight placeholder that will be replaced with the full response
    await this.redis.set(
      key,
      JSON.stringify({ status: 'processing', cachedAt: Date.now() }),
      'EX',
      this.ttlSeconds,
    );
  }

  /**
   * Stores the response for an idempotency key
   *
   * Called after successful request processing to cache the response
   * for future duplicate requests.
   *
   * @param idempotencyKey - Client-provided unique key
   * @param statusCode - HTTP status code of the response
   * @param body - Response body to cache
   */
  async storeResponse(idempotencyKey: string, statusCode: number, body: unknown): Promise<void> {
    const key = this.getKey(idempotencyKey);
    const cachedResult: CachedIdempotencyResult = {
      statusCode,
      body,
      cachedAt: Date.now(),
    };

    await this.redis.set(key, JSON.stringify(cachedResult), 'EX', this.ttlSeconds);
  }

  /**
   * Retrieves a cached response for an idempotency key
   *
   * @param idempotencyKey - Client-provided unique key
   * @returns Cached result if exists, null otherwise
   */
  async getCachedResponse(idempotencyKey: string): Promise<CachedIdempotencyResult | null> {
    const key = this.getKey(idempotencyKey);
    const cached = await this.redis.get(key);

    if (!cached) {
      return null;
    }

    return JSON.parse(cached) as CachedIdempotencyResult;
  }

  /**
   * Removes an idempotency key (for cleanup or testing)
   *
   * @param idempotencyKey - Client-provided unique key
   */
  async remove(idempotencyKey: string): Promise<void> {
    const key = this.getKey(idempotencyKey);
    await this.redis.del(key);
  }

  /**
   * Generates the Redis key for an idempotency key
   */
  private getKey(idempotencyKey: string): string {
    return `${RedisKeyPrefix.IDEMPOTENCY}:${idempotencyKey}`;
  }
}
