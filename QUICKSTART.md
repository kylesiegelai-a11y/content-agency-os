# Content Agency OS - Quick Start Guide

## Installation

### 1. Install Dependencies
```bash
npm install
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

## First Steps

### 1. Get Authentication Token

In development with mock mode, you can use this token directly:
```
Token: mock-jwt-token-for-development
```

Or login to get a real JWT token:
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

### 2. Create Your First Job

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

## Architecture Reference

For detailed architecture information, see `SYSTEM_ARCHITECTURE.md`

Key concepts:
- **Job State Machine**: Jobs flow through defined states
- **Agent Routing**: Each state routes to specific agent
- **Queue System**: Bull queues manage job processing
- **Scheduler**: Cron jobs drive pipeline cycles
- **Orchestrator**: Master routing and state management

## Support

For issues or questions, refer to:
1. `SYSTEM_ARCHITECTURE.md` - Complete system documentation
2. Comments in source code - Inline documentation
3. API endpoints - Try the endpoints to understand behavior
