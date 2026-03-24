# NotifyGate - End-to-End Testing Plan

> Complete testing guide for the Resilient Notification Gateway Microservice

---

## Table of Contents

1. [Prerequisites & Setup](#1-prerequisites--setup)
2. [Test Scenarios](#2-test-scenarios)
3. [Expected Results](#3-expected-results)
4. [Example Requests/Responses](#4-example-requestsresponses)
5. [Manual Testing Guide](#5-manual-testing-guide)
6. [Automated Testing](#6-automated-testing)
7. [CI/CD Integration](#7-cicd-integration)

---

## 1. Prerequisites & Setup

### 1.1 Environment Requirements

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Node.js | 20+ | Runtime environment |
| Redis | 7+ | Queue backing, rate limiting, idempotency cache |
| npm/yarn | Latest | Package management |

### 1.2 Initial Setup

```bash
# 1. Clone and install dependencies
git clone <repository-url>
cd resilient-notification-gateway
npm install

# 2. Configure environment
cp .env.example .env
```

### 1.3 Environment Configuration (.env)

```env
# Application
NODE_ENV=development
PORT=3000

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379

# Rate Limiting (requests per minute per user)
RATE_LIMIT_PER_MINUTE=10

# Idempotency Key TTL (in seconds)
IDEMPOTENCY_TTL=86400

# Queue Configuration
QUEUE_CONCURRENCY=5

# Testing: Force primary provider failure
FORCE_PRIMARY_FAILURE=false
```

### 1.4 Start Redis

**Option A: Docker (Recommended)**
```bash
docker run -d --name notifygate-redis -p 6379:6379 redis:7-alpine
```

**Option B: Docker Compose**
```bash
docker-compose up -d redis
```

**Option C: Local Installation**
```bash
# macOS
brew install redis && brew services start redis

# Ubuntu
sudo apt install redis-server && sudo systemctl start redis
```

### 1.5 Start the Application

```bash
# Development mode (with hot reload)
npm run start:dev

# Production mode
npm run build
npm run start:prod
```

### 1.6 Verify Setup

```bash
# Check health endpoint
curl http://localhost:3000/health

# Expected response:
# {"status":"healthy","timestamp":"...","checks":{"redis":{"status":"up"},"queue":{"status":"up"}}}
```

---

## 2. Test Scenarios

### Scenario 1: Provider Failover

**Objective:** Verify automatic failover when primary provider fails.

| Test Case | Description | Steps |
|-----------|-------------|-------|
| 1.1 | Primary succeeds | Send request with normal providers |
| 1.2 | Primary fails, fallback succeeds | Force primary failure, verify fallback |
| 1.3 | All providers fail | Force all providers to fail |

**Setup for Failover Testing:**
```bash
# Force primary provider to fail (simulates 5xx error)
export FORCE_PRIMARY_FAILURE=true

# Restart the application to pick up the env var
npm run start:dev
```

### Scenario 2: Idempotency

**Objective:** Verify duplicate requests return cached responses without creating duplicate jobs.

| Test Case | Description | Steps |
|-----------|-------------|-------|
| 2.1 | First request creates job | Send with new idempotency key |
| 2.2 | Duplicate returns cached response | Send same request again |
| 2.3 | Different key creates new job | Send with different idempotency key |
| 2.4 | Concurrent duplicates | Send same key multiple times simultaneously |

### Scenario 3: Rate Limiting

**Objective:** Verify per-user rate limiting (10 requests/minute).

| Test Case | Description | Steps |
|-----------|-------------|-------|
| 3.1 | Under limit succeeds | Send 5 requests |
| 3.2 | At limit succeeds | Send exactly 10 requests |
| 3.3 | Over limit rejected | Send 11th request, expect 429 |
| 3.4 | Different users independent | User A hits limit, User B still allowed |
| 3.5 | Rate limit resets | Wait 60 seconds, verify limit resets |

### Scenario 4: Health Check

**Objective:** Verify health check endpoints for monitoring.

| Test Case | Description | Steps |
|-----------|-------------|-------|
| 4.1 | Full health check | GET /health |
| 4.2 | Simple ping | GET /ping |
| 4.3 | Redis unhealthy | Stop Redis, check health status |

### Scenario 5: Input Validation

**Objective:** Verify request validation.

| Test Case | Description | Expected Status |
|-----------|-------------|-----------------|
| 5.1 | Invalid channel | 400 |
| 5.2 | Missing required fields | 400 |
| 5.3 | Invalid email format | 400 |
| 5.4 | Missing subject for email | 400 |
| 5.5 | Invalid UUID for idempotencyKey | 400 |
| 5.6 | Extra fields rejected | 400 |

---

## 3. Expected Results

### 3.1 Success Response (HTTP 202)

```json
{
  "success": true,
  "jobId": "job_abc123def456...",
  "statusCode": 202,
  "message": "Notification accepted for processing",
  "idempotencyKey": "550e8400-e29b-41d4-a716-446655440000"
}
```

### 3.2 Rate Limit Exceeded (HTTP 429)

```json
{
  "statusCode": 429,
  "message": "Rate limit exceeded. Limit: 10 requests per minute.",
  "error": "Too Many Requests",
  "retryAfter": 45,
  "currentCount": 10,
  "limit": 10
}
```

### 3.3 Validation Error (HTTP 400)

```json
{
  "statusCode": 400,
  "message": ["channel must be one of: email, sms, push"],
  "error": "Bad Request"
}
```

### 3.4 Health Check Response (HTTP 200)

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

### 3.5 Failover Behavior

| Scenario | Expected Behavior |
|----------|-------------------|
| Primary succeeds | Job completes with `providerUsed: "PrimaryEmailProvider"` |
| Primary fails | Log shows failover, job completes with `providerUsed: "FallbackEmailProvider"` |
| All fail | Job marked as failed, error logged |

---

## 4. Example Requests/Responses

### 4.1 Send Email Notification

**Request:**
```bash
curl -X POST http://localhost:3000/notifications/send \
  -H "Content-Type: application/json" \
  -d '{
    "idempotencyKey": "550e8400-e29b-41d4-a716-446655440000",
    "userId": "user_12345",
    "channel": "email",
    "recipient": "user@example.com",
    "subject": "Welcome to Our Service",
    "message": "Thank you for signing up!"
  }'
```

**Response (202 Accepted):**
```json
{
  "success": true,
  "jobId": "job_a1b2c3d4e5f6...",
  "statusCode": 202,
  "message": "Notification accepted for processing",
  "idempotencyKey": "550e8400-e29b-41d4-a716-446655440000"
}
```

### 4.2 Send SMS Notification

**Request:**
```bash
curl -X POST http://localhost:3000/notifications/send \
  -H "Content-Type: application/json" \
  -d '{
    "idempotencyKey": "660e8400-e29b-41d4-a716-446655440001",
    "userId": "user_12345",
    "channel": "sms",
    "recipient": "+15551234567",
    "message": "Your verification code is 123456"
  }'
```

**Response (202 Accepted):**
```json
{
  "success": true,
  "jobId": "job_b2c3d4e5f6g7...",
  "statusCode": 202,
  "message": "Notification accepted for processing",
  "idempotencyKey": "660e8400-e29b-41d4-a716-446655440001"
}
```

### 4.3 Send Push Notification

**Request:**
```bash
curl -X POST http://localhost:3000/notifications/send \
  -H "Content-Type: application/json" \
  -d '{
    "idempotencyKey": "770e8400-e29b-41d4-a716-446655440002",
    "userId": "user_12345",
    "channel": "push",
    "recipient": "device-token-abc123xyz",
    "message": "You have a new message"
  }'
```

### 4.4 Test Idempotency

**Send same request twice:**
```bash
# First request
IDEMPOTENCY_KEY=$(uuidgen | tr '[:upper:]' '[:lower:]')

curl -X POST http://localhost:3000/notifications/send \
  -H "Content-Type: application/json" \
  -d "{
    \"idempotencyKey\": \"$IDEMPOTENCY_KEY\",
    \"userId\": \"idempotency_test_user\",
    \"channel\": \"email\",
    \"recipient\": \"test@example.com\",
    \"subject\": \"Idempotency Test\",
    \"message\": \"Testing idempotency\"
  }"

# Second request (same idempotency key)
curl -X POST http://localhost:3000/notifications/send \
  -H "Content-Type: application/json" \
  -d "{
    \"idempotencyKey\": \"$IDEMPOTENCY_KEY\",
    \"userId\": \"idempotency_test_user\",
    \"channel\": \"email\",
    \"recipient\": \"test@example.com\",
    \"subject\": \"Idempotency Test\",
    \"message\": \"Testing idempotency\"
  }"
```

**Expected:** Both responses return the **same jobId**.

### 4.5 Test Rate Limiting

**Bash script to test rate limit:**
```bash
#!/bin/bash

USER_ID="rate_test_user_$(date +%s)"

echo "Sending 12 requests for user: $USER_ID"
echo "========================================"

for i in {1..12}; do
  RESPONSE=$(curl -s -w "\nSTATUS:%{http_code}" -X POST http://localhost:3000/notifications/send \
    -H "Content-Type: application/json" \
    -d "{
      \"idempotencyKey\": \"$(uuidgen | tr '[:upper:]' '[:lower:]')\",
      \"userId\": \"$USER_ID\",
      \"channel\": \"email\",
      \"recipient\": \"test@example.com\",
      \"subject\": \"Rate Test $i\",
      \"message\": \"Testing rate limit\"
    }")

  STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d: -f2)
  echo "Request $i: HTTP $STATUS"
done
```

**Expected Output:**
```
Request 1: HTTP 202
Request 2: HTTP 202
...
Request 10: HTTP 202
Request 11: HTTP 429
Request 12: HTTP 429
```

### 4.6 Test Failover

```bash
# 1. Start with primary failure forced
export FORCE_PRIMARY_FAILURE=true
npm run start:dev &

# 2. Wait for startup
sleep 5

# 3. Send notification
curl -X POST http://localhost:3000/notifications/send \
  -H "Content-Type: application/json" \
  -d '{
    "idempotencyKey": "failover-test-001",
    "userId": "failover_test_user",
    "channel": "email",
    "recipient": "failover@example.com",
    "subject": "Failover Test",
    "message": "Testing automatic failover"
  }'

# 4. Check logs for failover message
# Expected log: "Failover triggered to secondary provider"
```

### 4.7 Health Check

```bash
# Full health check
curl http://localhost:3000/health | jq

# Simple ping
curl http://localhost:3000/ping
# Expected: {"message":"pong"}
```

---

## 5. Manual Testing Guide

### 5.1 Quick Smoke Test Script

Save as `smoke-test.sh`:

```bash
#!/bin/bash

BASE_URL="http://localhost:3000"
PASS=0
FAIL=0

echo "🧪 NotifyGate Smoke Tests"
echo "=========================="

# Test 1: Health Check
echo -n "Test 1: Health check... "
RESPONSE=$(curl -s "$BASE_URL/health")
if echo "$RESPONSE" | grep -q '"status":"healthy"'; then
  echo "✅ PASS"
  ((PASS++))
else
  echo "❌ FAIL"
  ((FAIL++))
fi

# Test 2: Ping
echo -n "Test 2: Ping endpoint... "
RESPONSE=$(curl -s "$BASE_URL/ping")
if echo "$RESPONSE" | grep -q '"message":"pong"'; then
  echo "✅ PASS"
  ((PASS++))
else
  echo "❌ FAIL"
  ((FAIL++))
fi

# Test 3: Send Email
echo -n "Test 3: Send email notification... "
RESPONSE=$(curl -s -X POST "$BASE_URL/notifications/send" \
  -H "Content-Type: application/json" \
  -d "{
    \"idempotencyKey\": \"smoke-test-email-001\",
    \"userId\": \"smoke_test_user\",
    \"channel\": \"email\",
    \"recipient\": \"smoke@example.com\",
    \"subject\": \"Smoke Test\",
    \"message\": \"Testing\"
  }")
if echo "$RESPONSE" | grep -q '"success":true'; then
  echo "✅ PASS"
  ((PASS++))
else
  echo "❌ FAIL"
  ((FAIL++))
fi

# Test 4: Validation Error
echo -n "Test 4: Validation error handling... "
RESPONSE=$(curl -s -X POST "$BASE_URL/notifications/send" \
  -H "Content-Type: application/json" \
  -d '{"userId": "test"}')
if echo "$RESPONSE" | grep -q '"statusCode":400'; then
  echo "✅ PASS"
  ((PASS++))
else
  echo "❌ FAIL"
  ((FAIL++))
fi

# Test 5: Idempotency
echo -n "Test 5: Idempotency... "
RESP1=$(curl -s -X POST "$BASE_URL/notifications/send" \
  -H "Content-Type: application/json" \
  -d "{
    \"idempotencyKey\": \"smoke-test-idempotent-001\",
    \"userId\": \"idempotency_user\",
    \"channel\": \"sms\",
    \"recipient\": \"+15551234567\",
    \"message\": \"Idempotency test\"
  }")
RESP2=$(curl -s -X POST "$BASE_URL/notifications/send" \
  -H "Content-Type: application/json" \
  -d "{
    \"idempotencyKey\": \"smoke-test-idempotent-001\",
    \"userId\": \"idempotency_user\",
    \"channel\": \"sms\",
    \"recipient\": \"+15551234567\",
    \"message\": \"Idempotency test\"
  }")
JOB1=$(echo "$RESP1" | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)
JOB2=$(echo "$RESP2" | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)
if [ "$JOB1" = "$JOB2" ]; then
  echo "✅ PASS (same jobId returned)"
  ((PASS++))
else
  echo "❌ FAIL (different jobIds: $JOB1 vs $JOB2)"
  ((FAIL++))
fi

echo ""
echo "=========================="
echo "Results: $PASS passed, $FAIL failed"

if [ $FAIL -eq 0 ]; then
  echo "🎉 All tests passed!"
  exit 0
else
  echo "⚠️ Some tests failed"
  exit 1
fi
```

### 5.2 Run Smoke Tests

```bash
chmod +x smoke-test.sh
./smoke-test.sh
```

---

## 6. Automated Testing

### 6.1 Run Existing Test Suites

```bash
# Unit tests
npm test

# Unit tests with coverage
npm run test:cov

# E2E tests (requires Redis)
npm run test:e2e

# Run specific test file
npm test -- notifications.e2e-spec.ts

# Run with verbose output
npm test -- --verbose

# Run failover tests
FORCE_PRIMARY_FAILURE=true npm run test:e2e
```

### 6.2 Test File Structure

```
test/
├── jest-e2e.json              # E2E Jest configuration
├── notifications.e2e-spec.ts  # Main E2E tests
├── notifications-failover.e2e-spec.ts  # Failover tests
└── load-test.e2e-spec.ts      # Load/performance tests

src/
├── notifications/services/
│   ├── rate-limit.service.spec.ts    # Rate limit unit tests
│   └── idempotency.service.spec.ts   # Idempotency unit tests
└── providers/
    └── provider-registry.service.spec.ts  # Provider unit tests
```

### 6.3 Test Coverage Goals

| Component | Target Coverage |
|-----------|-----------------|
| Services | 80%+ |
| Controllers | 70%+ |
| Overall | 75%+ |

```bash
# Generate coverage report
npm run test:cov

# View report
open coverage/lcov-report/index.html
```

---

## 7. CI/CD Integration

### 7.1 GitHub Actions Workflow

Create `.github/workflows/test.yml`:

```yaml
name: Test Suite

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint:check

  unit-tests:
    name: Unit Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm test -- --coverage
      - uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info

  e2e-tests:
    name: E2E Tests
    runs-on: ubuntu-latest

    services:
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run test:e2e
        env:
          REDIS_HOST: localhost
          REDIS_PORT: 6379

  failover-tests:
    name: Failover Tests
    runs-on: ubuntu-latest

    services:
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run test:e2e -- --testPathPattern=notifications-failover
        env:
          REDIS_HOST: localhost
          REDIS_PORT: 6379
          FORCE_PRIMARY_FAILURE: true

  load-tests:
    name: Load Tests
    runs-on: ubuntu-latest
    needs: [unit-tests, e2e-tests]

    services:
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run test:e2e -- --testPathPattern=load-test
        env:
          REDIS_HOST: localhost
          REDIS_PORT: 6379

  build:
    name: Build
    runs-on: ubuntu-latest
    needs: [lint, unit-tests, e2e-tests]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
```

### 7.2 Docker-based Testing

Create `docker-compose.test.yml`:

```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  test-runner:
    build:
      context: .
      dockerfile: Dockerfile
    depends_on:
      redis:
        condition: service_healthy
    environment:
      - NODE_ENV=test
      - REDIS_HOST=redis
      - REDIS_PORT=6379
    command: >
      sh -c "npm run test:e2e"
```

**Run:**
```bash
docker-compose -f docker-compose.test.yml up --abort-on-container-exit
```

### 7.3 Pre-commit Hooks

Create `.husky/pre-commit`:

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

# Run linting
npm run lint:check

# Run unit tests
npm test -- --passWithNoTests
```

### 7.4 Jenkins Pipeline (Alternative)

```groovy
pipeline {
  agent any

  stages {
    stage('Install') {
      steps {
        sh 'npm ci'
      }
    }

    stage('Lint') {
      steps {
        sh 'npm run lint:check'
      }
    }

    stage('Unit Tests') {
      steps {
        sh 'npm test -- --coverage'
      }
      post {
        always {
          junit 'junit.xml'
          publishHTML(target: [
            allowMissing: false,
            alwaysLinkToLastBuild: true,
            keepAll: true,
            reportDir: 'coverage',
            reportFiles: 'lcov-report/index.html',
            reportName: 'Coverage Report'
          ])
        }
      }
    }

    stage('E2E Tests') {
      steps {
        sh 'docker-compose -f docker-compose.test.yml up --abort-on-container-exit'
      }
    }
  }
}
```

---

## Quick Reference

### Endpoint Summary

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/notifications/send` | POST | Send notification |
| `/health` | GET | Full health check |
| `/ping` | GET | Simple ping |
| `/api` | GET | Swagger docs |

### Response Codes

| Code | Meaning |
|------|---------|
| 202 | Accepted (success) |
| 400 | Bad Request (validation error) |
| 429 | Too Many Requests (rate limited) |
| 500 | Internal Server Error |

### Environment Variables for Testing

| Variable | Purpose | Test Value |
|----------|---------|------------|
| `FORCE_PRIMARY_FAILURE` | Simulate primary provider failure | `true` |
| `RATE_LIMIT_PER_MINUTE` | Override rate limit | `10` |
| `QUEUE_CONCURRENCY` | Worker concurrency | `5` |

---

## Troubleshooting

### Common Issues

1. **Redis connection refused**
   ```bash
   # Check Redis is running
   redis-cli ping
   # Start Redis
   docker run -d -p 6379:6379 redis:7-alpine
   ```

2. **Tests timeout**
   ```bash
   # Increase Jest timeout
   npm test -- --testTimeout=30000
   ```

3. **Port already in use**
   ```bash
   # Find and kill process
   lsof -i :3000
   kill -9 <PID>
   ```

4. **Flaky tests**
   - Clear Redis before each test run
   - Use unique idempotency keys
   - Wait for async operations to complete

---

*Document Version: 1.0.0*
*Last Updated: 2024*
