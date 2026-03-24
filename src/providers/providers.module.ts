import { Module } from '@nestjs/common';
import {
  PrimaryEmailProvider,
  FallbackEmailProvider,
  PrimarySmsProvider,
  FallbackSmsProvider,
  PrimaryPushProvider,
  FallbackPushProvider,
} from './mock-providers.service';
import { ProviderRegistryService } from './provider-registry.service';
import { StructuredLoggerService } from '../common/services/logger.service';

/**
 * Providers Module
 *
 * Provides notification provider implementations with failover support.
 * Registers all mock providers and the provider registry service.
 */
@Module({
  providers: [
    // Email providers
    PrimaryEmailProvider,
    FallbackEmailProvider,

    // SMS providers
    PrimarySmsProvider,
    FallbackSmsProvider,

    // Push providers
    PrimaryPushProvider,
    FallbackPushProvider,

    // Provider management
    ProviderRegistryService,
    StructuredLoggerService,
  ],
  exports: [
    ProviderRegistryService,
    PrimaryEmailProvider,
    FallbackEmailProvider,
    PrimarySmsProvider,
    FallbackSmsProvider,
    PrimaryPushProvider,
    FallbackPushProvider,
  ],
})
export class ProvidersModule {}
