import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { IdempotencyService } from './idempotency.service';
import { DuplicateRequestException } from '../../common/exceptions';

/**
 * Unit Tests: Idempotency Service
 *
 * Tests the Redis-based idempotency key management.
 * Verifies duplicate detection and response caching.
 */
describe('IdempotencyService', () => {
  let service: IdempotencyService;
  let mockRedis: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
    exists: jest.Mock;
  };

  beforeEach(async () => {
    // Create mock Redis client
    mockRedis = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue: unknown): unknown => {
        const config: Record<string, unknown> = {
          IDEMPOTENCY_TTL: 86400,
        };
        return config[key] ?? defaultValue;
      }),
    };

    const mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      logDuplicateDetected: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyService,
        {
          provide: 'REDIS_CLIENT',
          useValue: mockRedis,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: 'StructuredLoggerService',
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = module.get<IdempotencyService>(IdempotencyService);
  });

  describe('checkAndLock', () => {
    it('should allow first request with new idempotency key', async () => {
      // Mock no existing key
      mockRedis.get.mockResolvedValue(null);
      mockRedis.set.mockResolvedValue('OK');

      await expect(service.checkAndLock('new-key-123', 'user-123')).resolves.not.toThrow();

      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringContaining('idempotency'),
        expect.any(String),
        'EX',
        86400,
      );
    });

    it('should throw DuplicateRequestException for existing key', async () => {
      const cachedResponse = {
        statusCode: 202,
        body: {
          success: true,
          jobId: 'job-123',
          message: 'Notification accepted',
        },
        cachedAt: Date.now(),
      };

      // Mock existing cached response
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedResponse));

      await expect(service.checkAndLock('existing-key-456', 'user-456')).rejects.toThrow(
        DuplicateRequestException,
      );
    });

    it('should include cached response in exception', async () => {
      const cachedResponse = {
        statusCode: 202,
        body: {
          success: true,
          jobId: 'job-789',
        },
        cachedAt: Date.now(),
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(cachedResponse));

      try {
        await service.checkAndLock('cached-key', 'user-789');
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(DuplicateRequestException);
        expect((error as DuplicateRequestException).cachedResponse).toEqual(cachedResponse);
      }
    });
  });

  describe('storeResponse', () => {
    it('should store response with TTL', async () => {
      mockRedis.set.mockResolvedValue('OK');

      await service.storeResponse('key-123', 202, {
        success: true,
        jobId: 'job-123',
      });

      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringContaining('idempotency'),
        expect.any(String),
        'EX',
        86400,
      );
    });

    it('should store response body correctly', async () => {
      mockRedis.set.mockResolvedValue('OK');

      const responseBody = {
        success: true,
        jobId: 'job-456',
        message: 'Accepted',
      };

      await service.storeResponse('key-456', 202, responseBody);

      const setCall = mockRedis.set.mock.calls[0];
      const storedValue = JSON.parse(setCall[1]);

      expect(storedValue.statusCode).toBe(202);
      expect(storedValue.body).toEqual(responseBody);
      expect(storedValue.cachedAt).toBeDefined();
    });
  });

  describe('getCachedResponse', () => {
    it('should return cached response when exists', async () => {
      const cachedResponse = {
        statusCode: 202,
        body: { success: true },
        cachedAt: Date.now(),
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(cachedResponse));

      const result = await service.getCachedResponse('existing-key');

      expect(result).toEqual(cachedResponse);
    });

    it('should return null when key does not exist', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await service.getCachedResponse('non-existent-key');

      expect(result).toBeNull();
    });
  });

  describe('remove', () => {
    it('should delete idempotency key', async () => {
      mockRedis.del.mockResolvedValue(1);

      await service.remove('key-to-remove');

      expect(mockRedis.del).toHaveBeenCalledWith(expect.stringContaining('idempotency'));
    });
  });
});
