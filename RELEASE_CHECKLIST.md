# Content Agency OS — Release Checklist

## Pre-Release Validation

### 1. Test Suite
```bash
npm test
```
- [ ] All tests pass (195+ expected)
- [ ] No test timeouts or hanging processes
- [ ] Coverage ≥ 50% statements

### 2. E2E Pipeline Verification
```bash
npx jest tests/integration/e2e-pipeline.test.js --verbose
```
- [ ] Happy-path: job traverses DISCOVERED → DELIVERED (all 10 states)
- [ ] Failure-path: invalid agent output caught by transition guards
- [ ] Dead letter queue properly receives failed jobs

### 3. Mock Mode Smoke Test
```bash
MOCK_MODE=true npm run dev
```
- [ ] Server starts without errors
- [ ] Data stores initialize (`data/` directory populated)
- [ ] `GET /api/health` returns `{ status: 'ok' }`
- [ ] `GET /api/jobs` returns empty jobs array on fresh start
- [ ] Run a pipeline via `POST /api/pipeline/run` and verify completion

### 4. Data Store Integrity
- [ ] `jobs.json` — canonical job records with workflow state
- [ ] `activity.json` — append-only activity log
- [ ] `metrics.json` — dashboard metrics
- [ ] `portfolio.json` — completed work items
- [ ] `approvals.json` — pending/completed approvals
- [ ] `niches.json` — strategy agent niche data
- [ ] `ledger.json` — financial ledger

### 5. Agent Output Validation
Each agent's mock output matches the schema its consumer expects:
- [ ] `opportunityScorer` → returns `overallScore`, `recommendedBid`, `bidRange`
- [ ] `clientBrief` → returns `brief` object with `projectTitle`, `objectives`
- [ ] `writer` → returns `content` (string)
- [ ] `editor` → returns `review`, `scores` with `overallScore`
- [ ] `humanization` → returns `humanizedContent` (string)
- [ ] `qualityGate` → returns `overallScore`, `passed`, `assessment`
- [ ] `delivery` → returns `deliveryResults`, `status`

## Architecture Notes

### State Machine
```
DISCOVERED → SCORED → APPROVED → BRIEFED → WRITING → EDITING →
HUMANIZING → QUALITY_CHECK → APPROVED_CONTENT → DELIVERING → DELIVERED
```
- **Terminal state**: `DELIVERED` (no CLOSED in active pipeline)
- **Error states**: `FAILED` → `DEAD_LETTER`
- Transition guards in `orchestrator._validateAgentOutput()` catch malformed output before state advance

### Content Propagation
The orchestrator's `_propagateAgentOutput()` copies key fields between pipeline stages:
- Writer `content` → `job.content` (string) for editor/humanizer
- Humanizer `humanizedContent` → `job.content` for QA
- Before delivery: `job.content` reshaped to `{ title, body }`

### Logging
All orchestrator logging uses structured Winston logger with fields:
`{ jobId, agent, state, event, error }` — no raw `console.log` calls.

### Data Store Bootstrap
Server initializes all JSON stores on startup via `storage.initialize()` (idempotent — won't overwrite existing data).

## Post-Release
- [ ] Verify GitHub push succeeded
- [ ] Tag release: `git tag -a v0.5.0 -m "Hardening release"`
- [ ] Monitor logs for unexpected errors in first 24h
