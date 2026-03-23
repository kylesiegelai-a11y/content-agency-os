# Content Agency OS - System Architecture

## Overview

This is a complete, production-ready backend system for Content Agency OS that manages job orchestration, scheduling, and queue-based task processing. The system is built with Express.js, Bull queues, and node-cron scheduling.

## Files Created

### 1. **server.js** (24 KB)
Main Express server with complete REST API and middleware stack.

**Key Features:**
- CORS, Helmet security, Morgan logging middleware
- JWT authentication with token-based access control
- Full REST API with 30+ endpoints
- Global error handling middleware
- Graceful shutdown with signal handlers
- Static file serving for dashboard

**Port:** 3001 (configurable via PORT env var)

**Authentication:**
- POST `/api/auth/login` - Login with password, get JWT token
- POST `/api/auth/init-password` - Change admin password (first time setup)
- In mock mode, uses `MOCK_ADMIN_TOKEN` for development

### 2. **orchestrator.js** (13 KB)
Master routing brain that manages job state transitions and agent routing.

**Job State Machine:**
```
DISCOVERED → SCORED → APPROVED → BRIEFED → WRITING → EDITING →
HUMANIZING → QUALITY_CHECK → APPROVED_CONTENT → DELIVERING →
DELIVERED → CLOSED

Alternative pipeline:
PROSPECT_APPROVED → PROPOSAL_WRITING → PROPOSAL_REVIEW → PITCHED → CLOSED

Failure path:
[ANY STATE] → FAILED → DEAD_LETTER
```

**Agent Routing:**
- Qualifier: DISCOVERED, SCORED states
- Briefer: APPROVED state
- Writer: BRIEFED, WRITING states
- Editor: EDITING, HUMANIZING, QUALITY_CHECK states
- QA: QUALITY_CHECK state
- Delivery: APPROVED_CONTENT, DELIVERING states
- Prospector: Prospect pipeline states

**Key Capabilities:**
- Validate state transitions
- Route jobs to appropriate agent queues
- Handle job failures with exponential backoff retry (max 3 attempts)
- Move failed jobs to dead letter queue
- Calculate priority scores based on deadline proximity
- Accept test jobs for verification
- Track job status across all queues
- Activity logging for audit trail
- Dynamic agent loading with graceful fallbacks

### 3. **scheduler.js** (15 KB)
Cron-based task scheduler using node-cron for pipeline cycles.

**Scheduled Tasks:**
1. **Pipeline Cycle** - Every 4 hours
   - Processes jobs through their states
   - Monitors priority queue ordering
   - Checks deadline proximity

2. **Cold Outreach** - Daily at 9am
   - Identifies and qualifies new prospects
   - Creates prospect-outreach jobs

3. **Re-engagement** - Weekly Monday at 10am
   - Targets inactive clients
   - Generates re-engagement jobs with 14-day deadline

4. **Niche Expansion** - Monthly 1st at 11am
   - Evaluates new market opportunities
   - Creates research jobs

5. **Gmail Monitoring** - Every 15 minutes
   - Checks inbox for new leads and responses
   - Creates email-processing jobs with high priority (40)

6. **Accounting Summary** - Daily at midnight
   - Generates financial reports

**Task Management:**
- Pause/resume individual tasks via API
- Respects global kill switch
- Respects individual agent pause states
- Graceful shutdown
- Activity logging to activity.json in data directory

### 4. **utils/queueConfig.js** (6 KB)
Bull queue configuration with intelligent mock mode fallback.

**Features:**
- Redis-backed Bull queues for production
- In-memory queue implementation for MOCK_MODE
- Named queues: prospecting, writing, editing, communications, accounting
- Same API interface between Bull and in-memory queues
- Queue event handlers (completed, failed, stalled)
- Graceful shutdown with cleanup
- Rate limiting configuration
- Automatic retry with exponential backoff

**In-Memory Queue (Mock Mode):**
- Drop-in replacement for Bull queue
- Supports: add(), process(), on(), close(), getJob(), getJobCounts(), getJobs(), remove()
- Event listeners: completed, failed, stalled, progress, active
- Automatic job processing with configurable concurrency
- Exponential backoff retry logic

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login and get JWT token
- `POST /api/auth/init-password` - Initialize/change password

### Jobs Management
- `GET /api/jobs` - List jobs with filtering (state, queue)
- `POST /api/jobs` - Create new job
- `GET /api/jobs/:jobId` - Get job details
- `PATCH /api/jobs/:jobId` - Update/transition job state
- `DELETE /api/jobs/:jobId` - Cancel job

### Approvals
- `GET /api/approvals` - List jobs pending approval (SCORED, APPROVED_CONTENT states)
- `POST /api/approvals/:jobId/approve` - Approve and move to next state
- `POST /api/approvals/:jobId/reject` - Reject job (moves to dead letter)

### Metrics & Monitoring
- `GET /api/metrics` - System metrics and queue statistics
- `GET /api/activity` - Activity log with pagination
- `GET /api/system/status` - System health and status (uptime, mode, queues, dead letter)

### Portfolio & Clients
- `GET /api/portfolio` - Completed content library (DELIVERED, CLOSED jobs)
- `GET /api/clients` - List all clients

### Settings & Configuration
- `GET /api/settings` - Get system config (kill switch, agent pause states, scheduler tasks)
- `PATCH /api/settings` - Update configuration
- `POST /api/settings/kill-switch` - Toggle global kill switch
- `PATCH /api/settings/agents/:agentId` - Pause/unpause individual agent

### Scheduler Management
- `GET /api/scheduler/tasks` - List all scheduler tasks with status
- `POST /api/scheduler/tasks/:taskId/pause` - Pause scheduler task
- `POST /api/scheduler/tasks/:taskId/resume` - Resume scheduler task

### Dead Letter Queue
- `GET /api/dead-letter-queue` - Get failed jobs (limit: 50)
- `POST /api/dead-letter-queue/:jobId/retry` - Retry failed job

## Environment Variables

```
# Server
PORT=3001                           # Default: 3001
MOCK_MODE=true                      # Default: false, enables mock queues
NODE_ENV=development                # development, production

# Authentication
JWT_SECRET=your-secret-key          # Default: dev-secret-key
ADMIN_PASSWORD=your-password        # Default: admin123

# Redis (optional, only needed if not in MOCK_MODE)
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost                # Default: localhost
REDIS_PORT=6379                     # Default: 6379

# System
MAX_RETRIES=3                        # Default: 3 retries per job
```

## Starting the Server

### Prerequisites
```bash
npm install express cors helmet morgan jsonwebtoken bull cron dotenv redis
```

### Development (Mock Mode)
```bash
MOCK_MODE=true npm start
# or
node server.js
```

### Production (With Redis)
```bash
REDIS_URL=redis://production-redis:6379 \
JWT_SECRET=your-production-secret \
ADMIN_PASSWORD=your-secure-password \
NODE_ENV=production \
npm start
```

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      Express Server                         │
│                      (server.js)                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │          REST API Routes & Middleware                │  │
│  │  ├─ Auth (login, init-password)                      │  │
│  │  ├─ Jobs (CRUD, state transitions)                  │  │
│  │  ├─ Approvals (approve/reject)                      │  │
│  │  ├─ Metrics & Activity                              │  │
│  │  ├─ Portfolio & Clients                             │  │
│  │  ├─ Settings (kill switch, agent toggles)           │  │
│  │  ├─ Scheduler (pause/resume tasks)                  │  │
│  │  └─ Dead Letter Queue (retry failed jobs)           │  │
│  └──────────────────────────────────────────────────────┘  │
│                         ↓                                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Orchestrator (orchestrator.js)                │  │
│  │  ├─ State Machine & Validation                       │  │
│  │  ├─ Dynamic Agent Loading                           │  │
│  │  ├─ Job Routing to Queues                           │  │
│  │  ├─ Retry Logic (3x exponential backoff)            │  │
│  │  └─ Dead Letter Queue Management                    │  │
│  └──────────────────────────────────────────────────────┘  │
│         ↓                              ↓                    │
│  ┌──────────────────┐        ┌──────────────────┐         │
│  │   Scheduler      │        │  Bull Queues     │         │
│  │  (scheduler.js)  │        │  (queueConfig)   │         │
│  │                  │        │                  │         │
│  │ 6 Cron Tasks:    │        │ Queues:          │         │
│  │ • Pipeline (4h)  │        │ • prospecting    │         │
│  │ • Cold Outreach  │───────→│ • writing        │         │
│  │ • Re-engagement  │        │ • editing        │         │
│  │ • Niche Expand   │        │ • communications │         │
│  │ • Gmail Monitor  │        │ • accounting     │         │
│  │ • Accounting     │        │                  │         │
│  └──────────────────┘        └──────────────────┘         │
│                                      ↓                      │
│                          ┌──────────────────────┐           │
│                          │  Agent Modules       │           │
│                          │  (dynamic loading)   │           │
│                          │                      │           │
│                          │ • qualifierAgent.js  │           │
│                          │ • writerAgent.js     │           │
│                          │ • editorAgent.js     │           │
│                          │ • etc.               │           │
│                          └──────────────────────┘           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                            ↓
              ┌─────────────────────────┐
              │   Redis (Production)    │
              │   or In-Memory (Mock)   │
              └─────────────────────────┘
```

## Key Design Patterns

### 1. State Machine
Jobs follow a strict state transition graph. Invalid transitions are rejected with validation.

### 2. Agent Routing
Each job state automatically routes to the correct agent based on AGENT_ROUTES mapping.

### 3. Retry Logic
- Failed jobs retry up to 3 times with exponential backoff
- After max retries, jobs move to dead letter queue
- Dead letter jobs can be manually retried via API

### 4. Priority Queue
Priority scores calculated based on:
- User-specified priority (0-100)
- Deadline proximity:
  - < 24 hours: +100
  - < 72 hours: +50
  - < 7 days: +25

### 5. Mock Mode
When `MOCK_MODE=true` and Redis unavailable:
- Uses in-memory queue with same Bull API
- Jobs stored in memory with auto-processing
- Perfect for development and testing
- Zero external dependencies

### 6. Kill Switch
- Global kill switch disables ALL scheduled tasks
- Individual agent pause states disable specific agents
- Respects both settings when determining if task should run

## Monitoring & Observability

### Activity Logging
- All significant events logged to activity.json
- Tracked in orchestrator's in-memory activity log
- API endpoint: `GET /api/activity`

### Queue Statistics
- Real-time queue counts (waiting, active, completed, failed)
- Per-queue monitoring
- API endpoint: `GET /api/metrics`

### System Status
- Uptime tracking
- Mode reporting (MOCK/PRODUCTION)
- Dead letter queue monitoring
- API endpoint: `GET /api/system/status`

## Error Handling

### Graceful Degradation
- Missing agents are logged but don't crash the system
- Jobs still queue even if agent unavailable
- Errors are captured and logged

### Retry Strategy
1. Job fails in agent
2. Logged as retry attempt
3. Re-queued with exponential backoff delay
4. If max retries exceeded, moved to dead letter queue
5. Can be manually retried via API

### Shutdown Sequence
1. Server stops accepting new connections
2. Scheduler tasks stopped
3. All queues closed gracefully
4. Process exits with code 0

## Security

- **JWT Authentication**: All API endpoints except login require valid JWT token
- **Helmet Security Headers**: XSS, CSRF, clickjacking protection
- **CORS**: Configurable cross-origin request handling
- **Environment Variables**: Secrets stored in .env, not in code
- **Password Initialization**: Secure password change endpoint

## Testing

### Create Test Job
```bash
curl -X POST http://localhost:3001/api/jobs \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "content-creation",
    "priority": 50,
    "deadline": "2026-03-30T00:00:00Z",
    "data": {
      "client": "Test Client",
      "topic": "AI in Business"
    }
  }'
```

### Check Job Status
```bash
curl http://localhost:3001/api/jobs/test-123456 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### View Metrics
```bash
curl http://localhost:3001/api/metrics \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Performance Characteristics

- **Job Throughput**: Depends on agent processing time, typically 10-100 jobs/hour per agent
- **Queue Memory**: ~100 bytes per job in memory
- **Dead Letter Queue**: Keeps last 100 failed jobs by default
- **Activity Log**: Keeps last 10,000 entries in file, last 1,000 in memory
- **Scheduler Overhead**: Minimal, ~1ms per 15-minute cycle

## Future Enhancements

- [ ] Persistent job storage (database)
- [ ] WebSocket real-time job updates
- [ ] Multi-tenant support
- [ ] Advanced analytics dashboard
- [ ] Machine learning-based job priority
- [ ] Email notifications for job events
- [ ] Webhook integrations
- [ ] Agent performance metrics
- [ ] Batch job operations
