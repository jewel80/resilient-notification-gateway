import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/**
 * Health Module
 *
 * Provides health check endpoints for monitoring and orchestration.
 * Dependencies (Redis) are injected from the global RedisModule.
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
