import { Test, TestingModule } from '@nestjs/testing';
import { ProviderRegistryService } from './provider-registry.service';
import {
  PrimaryEmailProvider,
  FallbackEmailProvider,
  PrimarySmsProvider,
  FallbackSmsProvider,
  PrimaryPushProvider,
  FallbackPushProvider,
} from './mock-providers.service';
import { StructuredLoggerService } from '../common/services/logger.service';
import { NotificationChannel } from '../common/constants';
import { AllProvidersFailedException } from '../common/exceptions';

/**
 * Unit Tests: Provider Registry Service
 *
 * Tests the failover logic for notification providers.
 * Verifies that when the primary provider fails, the fallback is automatically used.
 */
describe('ProviderRegistryService', () => {
  let service: ProviderRegistryService;
  let primaryEmailProvider: PrimaryEmailProvider;
  let fallbackEmailProvider: FallbackEmailProvider;
  let logger: StructuredLoggerService;

  beforeEach(async () => {
    // Create mock logger
    const mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      logProviderAttempt: jest.fn(),
      logProviderFailed: jest.fn(),
      logFailoverTriggered: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProviderRegistryService,
        PrimaryEmailProvider,
        FallbackEmailProvider,
        PrimarySmsProvider,
        FallbackSmsProvider,
        PrimaryPushProvider,
        FallbackPushProvider,
        {
          provide: StructuredLoggerService,
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = module.get<ProviderRegistryService>(ProviderRegistryService);
    primaryEmailProvider = module.get<PrimaryEmailProvider>(PrimaryEmailProvider);
    fallbackEmailProvider = module.get<FallbackEmailProvider>(FallbackEmailProvider);
    logger = module.get<StructuredLoggerService>(StructuredLoggerService);
  });

  describe('sendWithFailover', () => {
    const mockPayload = {
      userId: 'test-user',
      recipient: 'test@example.com',
      message: 'Test message',
    };

    it('should return success when primary provider succeeds', async () => {
      // Mock primary provider to succeed
      jest.spyOn(primaryEmailProvider, 'send').mockResolvedValue({
        success: true,
        messageId: 'primary-msg-123',
      });

      const result = await service.sendWithFailover(
        NotificationChannel.EMAIL,
        mockPayload,
        'job-123',
      );

      expect(result.response.success).toBe(true);
      expect(result.providerUsed).toBe('PrimaryEmailProvider');
      expect(logger.logProviderAttempt).toHaveBeenCalledWith(
        'job-123',
        'PrimaryEmailProvider',
        'email',
      );
    });

    it('should fallback to secondary provider when primary fails', async () => {
      // Mock primary provider to fail
      jest
        .spyOn(primaryEmailProvider, 'send')
        .mockRejectedValue(new Error('Primary provider failed'));

      // Mock fallback to succeed
      jest.spyOn(fallbackEmailProvider, 'send').mockResolvedValue({
        success: true,
        messageId: 'fallback-msg-456',
      });

      const result = await service.sendWithFailover(
        NotificationChannel.EMAIL,
        mockPayload,
        'job-456',
      );

      expect(result.response.success).toBe(true);
      expect(result.providerUsed).toBe('FallbackEmailProvider');
      expect(logger.logProviderFailed).toHaveBeenCalled();
      expect(logger.logFailoverTriggered).toHaveBeenCalled();
    });

    it('should throw AllProvidersFailedException when all providers fail', async () => {
      // Mock all providers to fail
      jest.spyOn(primaryEmailProvider, 'send').mockRejectedValue(new Error('Primary failed'));
      jest.spyOn(fallbackEmailProvider, 'send').mockRejectedValue(new Error('Fallback failed'));

      await expect(
        service.sendWithFailover(NotificationChannel.EMAIL, mockPayload, 'job-789'),
      ).rejects.toThrow(AllProvidersFailedException);
    });

    it('should log provider attempts in priority order', async () => {
      jest.spyOn(primaryEmailProvider, 'send').mockResolvedValue({
        success: true,
        messageId: 'msg-001',
      });

      await service.sendWithFailover(NotificationChannel.EMAIL, mockPayload, 'job-001');

      // Primary should be attempted first (priority 1)
      expect(logger.logProviderAttempt).toHaveBeenCalledWith(
        'job-001',
        'PrimaryEmailProvider',
        'email',
      );
    });
  });

  describe('getProvidersForChannel', () => {
    it('should return providers sorted by priority for email', () => {
      const providers = service.getProvidersForChannel(NotificationChannel.EMAIL);

      expect(providers).toHaveLength(2);
      expect(providers[0].name).toBe('PrimaryEmailProvider');
      expect(providers[1].name).toBe('FallbackEmailProvider');
    });

    it('should return providers sorted by priority for SMS', () => {
      const providers = service.getProvidersForChannel(NotificationChannel.SMS);

      expect(providers).toHaveLength(2);
      expect(providers[0].name).toBe('PrimarySmsProvider');
      expect(providers[1].name).toBe('FallbackSmsProvider');
    });

    it('should return providers sorted by priority for push', () => {
      const providers = service.getProvidersForChannel(NotificationChannel.PUSH);

      expect(providers).toHaveLength(2);
      expect(providers[0].name).toBe('PrimaryPushProvider');
      expect(providers[1].name).toBe('FallbackPushProvider');
    });
  });
});
