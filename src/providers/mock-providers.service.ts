import { Injectable } from '@nestjs/common';
import { NotificationChannel } from '../common/constants';
import { INotificationProvider, NotificationPayload, ProviderResponse } from '../common/interfaces';
import { ProviderException } from '../common/exceptions';

/**
 * Provider Configuration Interface
 *
 * Defines configurable behavior for mock providers.
 */
interface MockProviderConfig {
  /** Simulated failure rate (0-1, where 1 = always fail) */
  failureRate: number;
  /** Simulated response delay in milliseconds */
  delayMs: number;
  /** Whether to simulate 5xx errors specifically */
  simulate5xxError: boolean;
}

/**
 * Base Mock Provider
 *
 * Abstract base class providing common mock provider functionality.
 * Simulates realistic provider behavior including delays and failures.
 */
export abstract class BaseMockProvider implements INotificationProvider {
  abstract readonly name: string;
  abstract readonly channel: NotificationChannel;
  abstract readonly priority: number;

  protected config: MockProviderConfig;

  constructor(config?: Partial<MockProviderConfig>) {
    this.config = {
      failureRate: 0,
      delayMs: 100,
      simulate5xxError: false,
      ...config,
    };
  }

  /**
   * Simulates sending a notification with configurable behavior
   *
   * @param payload - The notification payload
   * @returns Simulated provider response
   * @throws ProviderException if configured to fail
   */
  async send(payload: NotificationPayload): Promise<ProviderResponse> {
    // Simulate network latency
    await this.simulateDelay();

    // Check if this request should fail based on configuration
    if (this.shouldFail()) {
      throw new ProviderException(
        this.name,
        this.config.simulate5xxError
          ? 'Internal server error (5xx)'
          : 'Provider temporarily unavailable',
        true, // Always retryable for failover
      );
    }

    // Return success response with mock message ID
    return {
      success: true,
      messageId: `${this.name.toLowerCase()}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      data: {
        recipient: payload.recipient,
        channel: this.channel,
        provider: this.name,
      },
    };
  }

  /**
   * Simulates network delay
   */
  protected async simulateDelay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.config.delayMs));
  }

  /**
   * Determines if this request should fail based on failure rate
   */
  protected shouldFail(): boolean {
    return Math.random() < this.config.failureRate;
  }
}

/**
 * Primary Email Provider
 *
 * Mock implementation of a primary email service provider (e.g., SendGrid).
 * Configured to fail deterministically for testing failover scenarios.
 */
@Injectable()
export class PrimaryEmailProvider extends BaseMockProvider {
  readonly name = 'PrimaryEmailProvider';
  readonly channel = NotificationChannel.EMAIL;
  readonly priority = 1;

  constructor() {
    // Configure to fail for testing failover
    // In production, this would be configured based on environment
    super({
      failureRate: process.env.FORCE_PRIMARY_FAILURE === 'true' ? 1 : 0,
      delayMs: 150,
      simulate5xxError: process.env.FORCE_PRIMARY_FAILURE === 'true',
    });
  }
}

/**
 * Fallback Email Provider
 *
 * Mock implementation of a fallback email service provider.
 * Used when the primary provider fails.
 */
@Injectable()
export class FallbackEmailProvider extends BaseMockProvider {
  readonly name = 'FallbackEmailProvider';
  readonly channel = NotificationChannel.EMAIL;
  readonly priority = 2;

  constructor() {
    super({
      failureRate: 0, // Always succeeds for fallback
      delayMs: 200,
      simulate5xxError: false,
    });
  }
}

/**
 * Primary SMS Provider
 *
 * Mock implementation of a primary SMS service provider (e.g., Twilio).
 */
@Injectable()
export class PrimarySmsProvider extends BaseMockProvider {
  readonly name = 'PrimarySmsProvider';
  readonly channel = NotificationChannel.SMS;
  readonly priority = 1;

  constructor() {
    super({
      failureRate: process.env.FORCE_PRIMARY_FAILURE === 'true' ? 1 : 0,
      delayMs: 120,
      simulate5xxError: process.env.FORCE_PRIMARY_FAILURE === 'true',
    });
  }
}

/**
 * Fallback SMS Provider
 *
 * Mock implementation of a fallback SMS service provider.
 */
@Injectable()
export class FallbackSmsProvider extends BaseMockProvider {
  readonly name = 'FallbackSmsProvider';
  readonly channel = NotificationChannel.SMS;
  readonly priority = 2;

  constructor() {
    super({
      failureRate: 0,
      delayMs: 180,
      simulate5xxError: false,
    });
  }
}

/**
 * Primary Push Provider
 *
 * Mock implementation of a primary push notification provider (e.g., FCM).
 */
@Injectable()
export class PrimaryPushProvider extends BaseMockProvider {
  readonly name = 'PrimaryPushProvider';
  readonly channel = NotificationChannel.PUSH;
  readonly priority = 1;

  constructor() {
    super({
      failureRate: process.env.FORCE_PRIMARY_FAILURE === 'true' ? 1 : 0,
      delayMs: 100,
      simulate5xxError: process.env.FORCE_PRIMARY_FAILURE === 'true',
    });
  }
}

/**
 * Fallback Push Provider
 *
 * Mock implementation of a fallback push notification provider.
 */
@Injectable()
export class FallbackPushProvider extends BaseMockProvider {
  readonly name = 'FallbackPushProvider';
  readonly channel = NotificationChannel.PUSH;
  readonly priority = 2;

  constructor() {
    super({
      failureRate: 0,
      delayMs: 150,
      simulate5xxError: false,
    });
  }
}
