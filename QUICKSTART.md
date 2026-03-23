# Content Agency OS - Quick Start Guide

## Golden Path — Validate from Fresh Clone

Run these commands in order to confirm everything works:

```bash
# 1. Install
npm ci

# 2. Build the dashboard
npm run build

# 3. Run the full test suite (serial to avoid port conflicts)
npm test -- --runInBand

# 4. Start the server in mock mode
MOCK_MODE=true npm start
```

The server starts on `http://localhost:3001`. Then log in and create a test job:

```bash
# 5. Log in (mock mode auto-creates credentials on first attempt)
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password": "admin123"}' | jq -r '.token')

# 6. Create a test job
curl -s -X POST http://localhost:3001/api/jobs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"content","priority":50,"data":{"client":"Acme Corp","topic":"AI Trends 2026","wordCount":2000}}' | jq

# 7. List jobs
curl -s http://localhost:3001/api/jobs \
  -H "Authorization: Bearer $TOKEN" | jq
```

A developer can validate the whole system in about 5 minutes with these steps.

---

## Installation

### 1. Install Dependencies
```bash
npm ci
```

### 2. Configure Environment
```bash
# Copy example environment file
cp .env.example .env

# For development (mock mode, no Redis needed):
# Just run with defaults - MOCK_MODE=true is recommended
```

### 3. Run Tests
```bash
npm test
```
All 195+ tests should pass, including E2E pipeline tests.

### 4. Start Server
```bash
# Development mode (mock queues, auto-reload):
npm run dev

# Production mode (requires Redis):
npm start
```

The server will start on `http://localhost:3001`

## Mock-Mode Authentication

Mock mode provides two auth methods that work with zero setup. No external services, no manual credential creation — just start the server and go.

### Which method to use

Use **Option A** for quick manual testing (curl, Postman). Use **Option B** when you want to exercise the real login flow (e.g., from the dashboard or integration tests).

### Option A — Hardcoded mock token (skip login entirely)

In mock mode, the server accepts this static token on any authenticated endpoint:

```
Authorization: Bearer mock-jwt-token-for-development
```

This token never expires and requires no login call.

### Option B — Login with default mock password

The default mock password is `admin123`. On the first login attempt in mock mode, the server auto-creates `data/auth.json` with a bcrypt hash of this password — no manual setup needed.

```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password": "admin123"}'

# Response:
# {
#   "success": true,
#   "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
#   "expiresIn": 86400
# }
```

The returned JWT is valid for 24 hours. Use it in `Authorization: Bearer <token>` headers.

### Production auth

In production (`MOCK_MODE=false`), the mock token is rejected and `JWT_SECRET` must be set as an environment variable. The server refuses to start without it.

## First Steps

### 1. Create Your First Job

```bash
curl -X POST http://localhost:3001/api/jobs \
  -H "Authorization: Bearer mock-jwt-token-for-development" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "content",
    "priority": 50,
    "deadline": "2026-03-30T00:00:00Z",
    "data": {
      "client": "Acme Corp",
      "topic": "10 AI Trends in 2026",
      "wordCount": 2000
    }
  }'
```

### 3. Check System Status

```bash
curl http://localhost:3001/api/system/status \
  -H "Authorization: Bearer mock-jwt-token-for-development" | jq

# Shows:
# - Uptime
# - Queue statistics
# - Dead letter queue
# - Configuration status
```

### 4. View Queued Jobs

```bash
curl http://localhost:3001/api/jobs \
  -H "Authorization: Bearer mock-jwt-token-for-development" | jq
```

### 5. Monitor Activity

```bash
curl http://localhost:3001/api/activity \
  -H "Authorization: Bearer mock-jwt-token-for-development" | jq
```

## Common Operations

### Approve a Job
```bash
curl -X POST http://localhost:3001/api/approvals/{jobId}/approve \
  -H "Authorization: Bearer mock-jwt-token-for-development" \
  -H "Content-Type: application/json" \
  -d '{"notes": "Approved for publishing"}'
```

### Reject a Job
```bash
curl -X POST http://localhost:3001/api/approvals/{jobId}/reject \
  -H "Authorization: Bearer mock-jwt-token-for-development" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Client requested changes"}'
```

### View Dead Letter Queue
```bash
curl http://localhost:3001/api/dead-letter-queue \
  -H "Authorization: Bearer mock-jwt-token-for-development" | jq
```

### Retry a Failed Job
```bash
curl -X POST http://localhost:3001/api/dead-letter-queue/{jobId}/retry \
  -H "Authorization: Bearer mock-jwt-token-for-development"
```

### Enable Global Kill Switch
```bash
curl -X POST http://localhost:3001/api/settings/kill-switch \
  -H "Authorization: Bearer mock-jwt-token-for-development" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```

### Pause Individual Agent
```bash
curl -X PATCH http://localhost:3001/api/settings/agents/writer \
  -H "Authorization: Bearer mock-jwt-token-for-development" \
  -H "Content-Type: application/json" \
  -d '{"paused": true}'
```

### List Scheduler Tasks
```bash
curl http://localhost:3001/api/scheduler/tasks \
  -H "Authorization: Bearer mock-jwt-token-for-development" | jq
```

### Pause Scheduler Task
```bash
curl -X POST http://localhost:3001/api/scheduler/tasks/pipeline-cycle/pause \
  -H "Authorization: Bearer mock-jwt-token-for-development"
```

## API Documentation

All API endpoints are documented in `SYSTEM_ARCHITECTURE.md` under the "API Endpoints" section.

Key endpoint categories:
- **Authentication** - Login and password management
- **Jobs** - CRUD operations and state management
- **Approvals** - Approve/reject jobs pending review
- **Metrics** - System statistics and monitoring
- **Settings** - Configuration and control
- **Scheduler** - Task scheduling management
- **Dead Letter Queue** - Failed job recovery

## Running with Mock Mode

Mock mode is enabled by default and requires no external dependencies:

```bash
# These are equivalent:
npm run dev
MOCK_MODE=true npm start
```

Mock mode features:
- In-memory job queue (no Redis)
- Deterministic mock AI responses matching each agent's expected schema
- Transition guards validate agent output before state advances
- Structured logging via Winston (jobId, agent, state, event fields)
- Data stores auto-bootstrap on first run (no manual `mkdir` needed)
- Full API functionality
- Zero external service dependencies

## Running with Production Redis

To use Redis (recommended for production):

### 1. Install and run Redis
```bash
# MacOS
brew install redis
brew services start redis

# Or Docker
docker run -d -p 6379:6379 redis:latest
```

### 2. Update .env
```bash
MOCK_MODE=false
NODE_ENV=production
REDIS_HOST=localhost
REDIS_PORT=6379
```

### 3. Start server
```bash
npm start
```

## Troubleshooting

### Port Already in Use
Change the port in .env:
```bash
PORT=3002 npm start
```

### Redis Connection Error
Make sure Redis is running:
```bash
redis-cli ping
# Should return: PONG
```

Or switch to mock mode:
```bash
MOCK_MODE=true npm start
```

### Jobs Not Processing
1. Check if kill switch is enabled: `GET /api/settings`
2. Check if agent is paused: `GET /api/settings`
3. Check job status: `GET /api/jobs/:jobId`
4. Check dead letter queue: `GET /api/dead-letter-queue`

### Authentication Errors
- Default password is `admin123` (change in production!)
- In mock mode, use token: `mock-jwt-token-for-development`
- After login, use returned token in Authorization header

## Next Steps

1. **Create agents** - Implement agent modules that process jobs
2. **Connect database** - Add persistent storage for jobs
3. **Build dashboard** - Create web UI in the dashboard directory
4. **Add email integration** - Connect to Gmail API for inbox monitoring
5. **Implement CRM integration** - Connect to your CRM system

## Job Lifecycle & Terminal States

The system has two pipelines, each with a distinct terminal state:

**Content pipeline** — a job flows through 11 states and stops at `DELIVERED`:
```
DISCOVERED → SCORED → APPROVED → BRIEFED → WRITING → EDITING →
HUMANIZING → QUALITY_CHECK → APPROVED_CONTENT → DELIVERING → DELIVERED
```

**Prospect pipeline** — proposals flow through 5 states and stop at `CLOSED`:
```
PROSPECT_APPROVED → PROPOSAL_WRITING → PROPOSAL_REVIEW → PITCHED → CLOSED
```

**Error path** — any job that exhausts retries lands in the dead letter queue:
```
[ANY STATE] → FAILED → DEAD_LETTER
```

`DELIVERED`, `CLOSED`, and `DEAD_LETTER` are the only terminal states. A job in a terminal state will never be processed again unless manually retried.

## Architecture Reference

For detailed architecture information, see `SYSTEM_ARCHITECTURE.md`

Key concepts:
- **Job State Machine**: Jobs flow through defined states with enforced transition guards
- **Agent Routing**: Each state routes to a specific agent module
- **Queue System**: Bull queues manage job processing (in-memory mock in dev)
- **Scheduler**: Cron jobs drive pipeline cycles
- **Orchestrator**: Master routing, state validation, and content propagation

## Pre-Ship Verification

Run the preflight script before every release:

```bash
npm run preflight
```

This runs install, build, tests, and a mock-server smoke test (login + create job + list jobs) in one pass. See also `RELEASE_CHECKLIST.md` for the full manual checklist.

## Support

For issues or questions, refer to:
1. `SYSTEM_ARCHITECTURE.md` - Complete system documentation
2. `RELEASE_CHECKLIST.md` - Pre-release validation checklist
3. Comments in source code - Inline documentation
4. API endpoints - Try the endpoints to understand behavior
