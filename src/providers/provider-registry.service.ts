import { Injectable } from '@nestjs/common';
import { NotificationChannel } from '../common/constants';
import { INotificationProvider, NotificationPayload, ProviderResponse } from '../common/interfaces';
import { AllProvidersFailedException, ProviderException } from '../common/exceptions';
import { StructuredLoggerService } from '../common/services/logger.service';
import {
  PrimaryEmailProvider,
  FallbackEmailProvider,
  PrimarySmsProvider,
  FallbackSmsProvider,
  PrimaryPushProvider,
  FallbackPushProvider,
} from './mock-providers.service';

/**
 * Provider Registry Service
 *
 * Manages notification providers and handles failover logic.
 * Selects the appropriate provider based on channel and availability.
 */
@Injectable()
export class ProviderRegistryService {
  /** Map of channel to sorted list of providers by priority */
  private providers: Map<NotificationChannel, INotificationProvider[]>;

  constructor(
    private readonly primaryEmail: PrimaryEmailProvider,
    private readonly fallbackEmail: FallbackEmailProvider,
    private readonly primarySms: PrimarySmsProvider,
    private readonly fallbackSms: FallbackSmsProvider,
    private readonly primaryPush: PrimaryPushProvider,
    private readonly fallbackPush: FallbackPushProvider,
    private readonly logger: StructuredLoggerService,
  ) {
    this.providers = this.initializeProviders();
  }

  /**
   * Initializes the provider registry with all available providers
   * grouped by channel and sorted by priority
   *
   * @returns Map of channel to provider arrays
   */
  private initializeProviders(): Map<NotificationChannel, INotificationProvider[]> {
    const providerMap = new Map<NotificationChannel, INotificationProvider[]>();

    // Email providers
    providerMap.set(
      NotificationChannel.EMAIL,
      [this.primaryEmail, this.fallbackEmail].sort((a, b) => a.priority - b.priority),
    );

    // SMS providers
    providerMap.set(
      NotificationChannel.SMS,
      [this.primarySms, this.fallbackSms].sort((a, b) => a.priority - b.priority),
    );

    // Push providers
    providerMap.set(
      NotificationChannel.PUSH,
      [this.primaryPush, this.fallbackPush].sort((a, b) => a.priority - b.priority),
    );

    return providerMap;
  }

  /**
   * Sends a notification using the appropriate provider with automatic failover
   *
   * Attempts to send using providers in priority order. If a provider fails
   * with a retryable error, automatically falls back to the next provider.
   *
   * @param channel - The notification channel
   * @param payload - The notification payload
   * @param jobId - Job ID for logging correlation
   * @returns Provider response from the successful provider
   * @throws AllProvidersFailedException if all providers fail
   */
  async sendWithFailover(
    channel: NotificationChannel,
    payload: NotificationPayload,
    jobId: string,
  ): Promise<{ response: ProviderResponse; providerUsed: string }> {
    const channelProviders = this.providers.get(channel);

    if (!channelProviders || channelProviders.length === 0) {
      throw new Error(`No providers configured for channel: ${channel}`);
    }

    const attemptedProviders: string[] = [];

    for (const provider of channelProviders) {
      attemptedProviders.push(provider.name);

      this.logger.logProviderAttempt(jobId, provider.name, channel);

      try {
        const response = await provider.send(payload);

        // Provider succeeded, return response
        return { response, providerUsed: provider.name };
      } catch (error) {
        if (error instanceof ProviderException) {
          this.logger.logProviderFailed(jobId, provider.name, channel, error.message);

          // Check if this error is retryable with another provider
          if (!error.isRetryable) {
            // Non-retryable error, don't attempt other providers
            throw error;
          }

          // Log failover if there's another provider to try
          const nextProvider = channelProviders[channelProviders.indexOf(provider) + 1];
          if (nextProvider) {
            this.logger.logFailoverTriggered(jobId, provider.name, nextProvider.name, channel);
          }
        } else {
          // Unknown error type, re-throw
          throw error;
        }
      }
    }

    // All providers failed
    throw new AllProvidersFailedException(channel, attemptedProviders);
  }

  /**
   * Gets all providers for a specific channel
   *
   * @param channel - The notification channel
   * @returns Array of providers for the channel
   */
  getProvidersForChannel(channel: NotificationChannel): INotificationProvider[] {
    return this.providers.get(channel) || [];
  }
}
