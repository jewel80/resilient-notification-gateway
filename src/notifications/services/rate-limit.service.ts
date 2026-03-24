import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisKeyPrefix, Defaults } from '../../common/constants';
import { RateLimitResult } from '../../common/interfaces';
import { REDIS_CLIENT } from '../../redis/redis.module';

/**
 * Rate Limiting Service
 *
 * Implements per-user rate limiting using Redis sliding window algorithm.
 * Provides accurate rate limiting with minimal Redis operations.
 *
 * Algorithm: Sliding Window
 * - Uses a sorted set to track request timestamps
 * - Old entries outside the window are automatically cleaned
 * - Provides accurate count within the sliding window
 */
@Injectable()
export class RateLimitService {
  private readonly limitPerMinute: number;
  private readonly windowSizeSeconds = 60;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {
    this.limitPerMinute = this.configService.get<number>(
      'RATE_LIMIT_PER_MINUTE',
      Defaults.RATE_LIMIT_PER_MINUTE,
    );
  }

  /**
   * Checks if a request is allowed under the rate limit
   *
   * Uses Redis sorted sets with Lua script for atomic operation.
   * Implements a sliding window counter with automatic cleanup.
   *
   * @param userId - User identifier to check rate limit for
   * @returns Rate limit check result with current count and reset time
   */
  async checkRateLimit(userId: string): Promise<RateLimitResult> {
    const key = this.getKey(userId);
    const now = Date.now();
    const windowStart = now - this.windowSizeSeconds * 1000;

    // Use a Lua script for atomic operation
    // This removes old entries, adds the new one, and returns the count
    const luaScript = `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local windowStart = tonumber(ARGV[2])
      local ttl = tonumber(ARGV[3])

      -- Remove entries outside the window
      redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)

      -- Count current entries in the window
      local count = redis.call('ZCARD', key)

      -- Return count (don't add new entry yet - let caller decide)
      return count
    `;

    const currentCount = await this.redis.eval(
      luaScript,
      1,
      key,
      now.toString(),
      windowStart.toString(),
      this.windowSizeSeconds.toString(),
    );

    const count = currentCount as number;

    if (count >= this.limitPerMinute) {
      // Get the oldest entry's timestamp to calculate reset time
      const oldestEntry = await this.redis.zrange(key, 0, 0, 'WITHSCORES');
      let resetIn = this.windowSizeSeconds;

      if (oldestEntry.length >= 2) {
        const oldestTimestamp = parseInt(oldestEntry[1], 10);
        const expiryTime = oldestTimestamp + this.windowSizeSeconds * 1000;
        resetIn = Math.ceil((expiryTime - now) / 1000);
      }

      return {
        allowed: false,
        currentCount: count,
        limit: this.limitPerMinute,
        resetIn: Math.max(1, resetIn),
      };
    }

    return {
      allowed: true,
      currentCount: count,
      limit: this.limitPerMinute,
      resetIn: this.windowSizeSeconds,
    };
  }

  /**
   * Records a request for rate limiting
   *
   * Adds a timestamped entry to the user's rate limit window.
   * Should be called after the rate check passes.
   *
   * @param userId - User identifier
   */
  async recordRequest(userId: string): Promise<void> {
    const key = this.getKey(userId);
    const now = Date.now();
    const windowStart = now - this.windowSizeSeconds * 1000;

    // Add the new request timestamp
    await this.redis.zadd(key, now, `${now}:${Math.random().toString(36).substr(2, 9)}`);

    // Set expiry on the key (cleanup for idle users)
    await this.redis.expire(key, this.windowSizeSeconds + 10);

    // Clean up old entries
    await this.redis.zremrangebyscore(key, 0, windowStart);
  }

  /**
   * Gets the current request count for a user without recording
   *
   * @param userId - User identifier
   * @returns Current request count in the window
   */
  async getCurrentCount(userId: string): Promise<number> {
    const key = this.getKey(userId);
    const now = Date.now();
    const windowStart = now - this.windowSizeSeconds * 1000;

    // Remove old entries and count
    await this.redis.zremrangebyscore(key, 0, windowStart);
    const count = await this.redis.zcard(key);

    return count;
  }

  /**
   * Resets rate limit for a user (for testing purposes)
   *
   * @param userId - User identifier
   */
  async resetRateLimit(userId: string): Promise<void> {
    const key = this.getKey(userId);
    await this.redis.del(key);
  }

  /**
   * Generates the Redis key for a user's rate limit
   */
  private getKey(userId: string): string {
    return `${RedisKeyPrefix.RATE_LIMIT}:${userId}`;
  }
}
