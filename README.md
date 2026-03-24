# NotifyGate - Resilient Notification Gateway Microservice

A production-grade notification gateway microservice built with Node.js, TypeScript, and NestJS. Abstracts third-party notification providers (SendGrid, Twilio, etc.) behind a single, reliable API with built-in resilience, idempotency, and observability.

## Features

- **Unified API**: Single endpoint for Email, SMS, and Push notifications
- **Automatic Failover**: Primary provider failures trigger automatic fallback
- **Request Idempotency**: Duplicate requests return cached responses
- **Per-User Rate Limiting**: Redis-based sliding window (10 requests/minute)
- **Async Processing**: BullMQ queue for non-blocking notification delivery
- **Observability**: Structured JSON logging for all significant events
- **Health Checks**: Built-in endpoints for monitoring and orchestration

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Request                           │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    API Layer (NestJS)                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Rate      │  │ Idempotency │  │   Validation Pipe       │  │
│  │   Limiter   │  │   Check     │  │   (class-validator)     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼ HTTP 202 Accepted
┌─────────────────────────────────────────────────────────────────┐
│                    BullMQ Queue (Redis)                         │
│                     Async Job Processing                        │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Provider Layer                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │   Primary    │  │   Fallback   │  │   Failover Logic     │   │
│  │   Provider   │──│   Provider   │  │   (Auto-retry)       │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│              External Providers (SendGrid, Twilio, FCM)         │
└─────────────────────────────────────────────────────────────────┘
```

## Project Structure

```
src/
├── common/
│   ├── constants/          # Enums and configuration constants
│   ├── exceptions/         # Custom exception classes
│   ├── interfaces/         # TypeScript interfaces
│   └── services/
│       └── logger.service.ts  # Structured JSON logging
├── health/
│   ├── health.controller.ts   # Health check endpoints
│   └── health.module.ts
├── notifications/
│   ├── dto/
│   │   └── notification.dto.ts  # Request/Response DTOs
│   ├── services/
│   │   ├── idempotency.service.ts  # Redis-based deduplication
│   │   ├── notification.service.ts  # Core business logic
│   │   └── rate-limit.service.ts    # Sliding window rate limiting
│   ├── notifications.controller.ts  # POST /notifications/send
│   └── notifications.module.ts
├── providers/
│   ├── mock-providers.service.ts    # Mock provider implementations
│   ├── provider-registry.service.ts # Failover orchestration
│   └── providers.module.ts
├── queue/
│   └── queue.module.ts  # BullMQ configuration
├── redis/
│   └── redis.module.ts  # Redis connection
├── app.module.ts
└── main.ts
```

## Quick Start

### Prerequisites

- Node.js 20+
- Redis 7+
- npm or yarn

### Local Development

1. **Clone and install dependencies**

```bash
git clone <repository-url>
cd NotifyGate
npm install
```

2. **Configure environment**

```bash
cp .env.example .env
# Edit .env with your configuration
```

3. **Start Redis** (using Docker)

```bash
docker run -d --name redis -p 6379:6379 redis:7-alpine
```

4. **Start the development server**

```bash
npm run start:dev
```

The service will be available at `http://localhost:3000`

### Using Docker Compose

```bash
docker-compose up -d
```

This starts both Redis and the API service.

## API Documentation

### Send Notification

**POST** `/notifications/send`

Accepts a notification request and queues it for background processing.

**Request Body:**

```json
{
  "idempotencyKey": "550e8400-e29b-41d4-a716-446655440000",
  "userId": "user_123",
  "channel": "email",
  "recipient": "user@example.com",
  "subject": "Welcome!",
  "message": "Thank you for signing up!"
}
```

**Response (202 Accepted):**

```json
{
  "success": true,
  "jobId": "job_abc123...",
  "statusCode": 202,
  "message": "Notification accepted for processing",
  "idempotencyKey": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Error Responses:**

| Status | Description |
|--------|-------------|
| 400 | Invalid request payload |
| 429 | Rate limit exceeded (10 requests/minute) |

### Health Check

**GET** `/health`

Returns service health status including Redis connectivity.

**Response:**

```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "version": "1.0.0",
  "checks": {
    "redis": {
      "status": "up",
      "latency": 2
    },
    "queue": {
      "status": "up"
    }
  },
  "uptime": 3600
}
```

**GET** `/ping`

Simple ping endpoint for load balancer health checks.

## Configuration

Environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment | `development` |
| `REDIS_HOST` | Redis hostname | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `RATE_LIMIT_PER_MINUTE` | Max requests per user per minute | `10` |
| `IDEMPOTENCY_TTL` | Idempotency key TTL (seconds) | `86400` |
| `QUEUE_CONCURRENCY` | Number of concurrent job processors | `5` |
| `FORCE_PRIMARY_FAILURE` | Force primary provider failure (testing) | `false` |

## Testing

### Run All Tests

```bash
npm test
```

### Run Integration Tests

```bash
npm run test:e2e
```

### Test Failover Scenario

The integration tests automatically verify the failover path:

1. Set `FORCE_PRIMARY_FAILURE=true` to simulate primary provider failure
2. Send a notification request
3. Verify the job completes successfully using the fallback provider

```bash
FORCE_PRIMARY_FAILURE=true npm run test:e2e
```

## Architectural Decisions

### 1. Async Processing with BullMQ

**Decision**: Use BullMQ for background job processing instead of synchronous provider calls.

**Rationale**:
- Non-blocking API responses (HTTP 202)
- Automatic retries with exponential backoff
- Job persistence for reliability
- Built-in job events for monitoring

### 2. Sliding Window Rate Limiting

**Decision**: Implement per-user rate limiting using Redis sorted sets.

**Rationale**:
- More accurate than fixed window
- Atomic operations via Lua scripts
- No memory bloat (automatic cleanup)
- Consistent rate limiting across instances

### 3. Provider Failover Pattern

**Decision**: Primary/fallback provider architecture with automatic failover.

**Rationale**:
- Resilience to provider outages
- No client-side changes needed
- Deterministic testing via configuration
- Easy to add more providers

### 4. Idempotency via Redis

**Decision**: Store idempotency keys with cached responses in Redis.

**Rationale**:
- Fast lookups for duplicate detection
- Automatic TTL cleanup
- Works across multiple instances
- Prevents duplicate notifications

## Known Trade-offs

1. **At-least-once Delivery**: The system provides at-least-once delivery semantics. In rare failure scenarios, notifications might be delivered multiple times. Clients should handle this or implement deduplication.

2. **No Dead Letter Queue**: Failed jobs are retained for 24 hours but there's no automatic DLQ. Production deployments should add monitoring and alerting for failed jobs.

3. **Single Redis Instance**: The current setup uses a single Redis instance. For production, consider Redis Sentinel or Cluster for high availability.

4. **Mock Providers**: The current implementation uses mock providers. Integration with real providers (SendGrid, Twilio) requires additional SDK integration and API key management.

## API Reference (Swagger)

Access the interactive API documentation at:

```
http://localhost:3000/api
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm test && npm run test:e2e`
5. Submit a pull request

## License

MIT License - see LICENSE file for details.
