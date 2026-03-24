import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RateLimitService } from './rate-limit.service';

/**
 * Unit Tests: Rate Limit Service
 *
 * Tests the Redis-based sliding window rate limiting implementation.
 * Verifies correct behavior under various request patterns.
 */
describe('RateLimitService', () => {
  let service: RateLimitService;
  let mockRedis: {
    eval: jest.Mock;
    zadd: jest.Mock;
    zremrangebyscore: jest.Mock;
    zcard: jest.Mock;
    zrange: jest.Mock;
    expire: jest.Mock;
    del: jest.Mock;
  };

  beforeEach(async () => {
    // Create mock Redis client
    mockRedis = {
      eval: jest.fn(),
      zadd: jest.fn(),
      zremrangebyscore: jest.fn(),
      zcard: jest.fn(),
      zrange: jest.fn(),
      expire: jest.fn(),
      del: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue: unknown): unknown => {
        const config: Record<string, unknown> = {
          RATE_LIMIT_PER_MINUTE: 10,
        };
        return config[key] ?? defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimitService,
        {
          provide: 'REDIS_CLIENT',
          useValue: mockRedis,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<RateLimitService>(RateLimitService);
  });

  describe('checkRateLimit', () => {
    it('should allow request when under limit', async () => {
      // Mock current count as 5 (under limit of 10)
      mockRedis.eval.mockResolvedValue(5);
      mockRedis.zrange.mockResolvedValue([]);

      const result = await service.checkRateLimit('user-123');

      expect(result.allowed).toBe(true);
      expect(result.currentCount).toBe(5);
      expect(result.limit).toBe(10);
    });

    it('should deny request when at limit', async () => {
      // Mock current count as 10 (at limit)
      mockRedis.eval.mockResolvedValue(10);
      mockRedis.zrange.mockResolvedValue(['1704067200000:abc', '1704067200000']);

      const result = await service.checkRateLimit('user-456');

      expect(result.allowed).toBe(false);
      expect(result.currentCount).toBe(10);
      expect(result.resetIn).toBeGreaterThan(0);
    });

    it('should deny request when over limit', async () => {
      // Mock current count as 15 (over limit)
      mockRedis.eval.mockResolvedValue(15);
      mockRedis.zrange.mockResolvedValue(['1704067200000:abc', '1704067200000']);

      const result = await service.checkRateLimit('user-789');

      expect(result.allowed).toBe(false);
      expect(result.currentCount).toBe(15);
    });

    it('should allow first request (count 0)', async () => {
      mockRedis.eval.mockResolvedValue(0);

      const result = await service.checkRateLimit('new-user');

      expect(result.allowed).toBe(true);
      expect(result.currentCount).toBe(0);
    });
  });

  describe('recordRequest', () => {
    it('should add timestamp to sorted set', async () => {
      mockRedis.zadd.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);
      mockRedis.zremrangebyscore.mockResolvedValue(0);

      await service.recordRequest('user-123');

      expect(mockRedis.zadd).toHaveBeenCalled();
      expect(mockRedis.expire).toHaveBeenCalled();
    });
  });

  describe('getCurrentCount', () => {
    it('should return current request count', async () => {
      mockRedis.zremrangebyscore.mockResolvedValue(0);
      mockRedis.zcard.mockResolvedValue(7);

      const count = await service.getCurrentCount('user-123');

      expect(count).toBe(7);
    });
  });

  describe('resetRateLimit', () => {
    it('should delete rate limit key', async () => {
      mockRedis.del.mockResolvedValue(1);

      await service.resetRateLimit('user-123');

      expect(mockRedis.del).toHaveBeenCalled();
    });
  });
});
