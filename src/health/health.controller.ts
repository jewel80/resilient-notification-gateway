import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

/**
 * Health Status Response Interface
 */
interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  version: string;
  checks: {
    redis: {
      status: 'up' | 'down';
      latency?: number;
      error?: string;
    };
    queue: {
      status: 'up' | 'down';
      error?: string;
    };
  };
  uptime: number;
}

/**
 * Health Controller
 *
 * Provides health check endpoints for monitoring and orchestration.
 * Returns service status and dependency connectivity information.
 */
@ApiTags('health')
@Controller()
export class HealthController {
  private readonly startTime = Date.now();

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Health Check Endpoint
   *
   * Returns the overall health status of the service including:
   * - Service status (healthy/unhealthy)
   * - Redis connectivity
   * - Queue status
   * - Service uptime
   */
  @Get('health')
  @ApiOperation({ summary: 'Health check endpoint' })
  @ApiResponse({
    status: 200,
    description: 'Service health status',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['healthy', 'unhealthy'] },
        timestamp: { type: 'string' },
        version: { type: 'string' },
        checks: {
          type: 'object',
          properties: {
            redis: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: ['up', 'down'] },
                latency: { type: 'number' },
                error: { type: 'string' },
              },
            },
            queue: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: ['up', 'down'] },
                error: { type: 'string' },
              },
            },
          },
        },
        uptime: { type: 'number' },
      },
    },
  })
  async healthCheck(): Promise<HealthStatus> {
    const checks = {
      redis: await this.checkRedis(),
      queue: await this.checkQueue(),
    };

    // Determine overall status
    const allHealthy = checks.redis.status === 'up' && checks.queue.status === 'up';

    return {
      status: allHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      checks,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }

  /**
   * Simple ping endpoint for load balancer checks
   */
  @Get('ping')
  @ApiOperation({ summary: 'Simple ping endpoint' })
  @ApiResponse({ status: 200, description: 'Pong response' })
  ping(): { message: string } {
    return { message: 'pong' };
  }

  /**
   * Checks Redis connectivity
   */
  private async checkRedis(): Promise<{ status: 'up' | 'down'; latency?: number; error?: string }> {
    try {
      const startTime = Date.now();
      await this.redis.ping();
      const latency = Date.now() - startTime;

      return {
        status: 'up',
        latency,
      };
    } catch (error) {
      return {
        status: 'down',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Checks queue connectivity (via Redis)
   */
  private async checkQueue(): Promise<{ status: 'up' | 'down'; error?: string }> {
    try {
      // Check if we can access the queue's Redis connection
      // BullMQ uses the same Redis connection
      await this.redis.get('bull:notifications:id');

      return {
        status: 'up',
      };
    } catch (error) {
      return {
        status: 'down',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
