# Content Agency OS — Autonomous Operation Guide

**Status:** Hardened for autonomous use with safety guardrails.

## First Autonomous Lane: Content Pipeline

The content production pipeline (DISCOVERED → DELIVERED) is the first workflow hardened for autonomous operation.

**What is fully autonomous:**
- Job intake via acquisition engine (forms, Gmail, CSV, referrals)
- Opportunity scoring and qualification
- Client briefing
- Content writing, editing, humanization, quality check
- Delivery formatting (Markdown, PDF, HTML, Google Docs)
- Invoice auto-generation on delivery
- Client notification on delivery

**What is intentionally gated:**
- Cold outreach emails (subject to policy guards, send windows, rate limits)
- All external sends blocked by kill switch when enabled
- All external actions logged to operations ledger for audit

**What remains manual:**
- Production API credential setup (Anthropic, Gmail, Calendly)
- Client onboarding (adding client records)
- Invoice payment reconciliation (Stripe integration is scaffolded)
- Dead-letter queue review and retry decisions

## Safety Infrastructure

### Operation Log (`utils/operationLog.js`)

Every external action goes through `executeOperation()` which provides:
- **Idempotency**: Deterministic keys prevent duplicate emails, invoices, deliveries
- **Kill switch**: `KILL_SWITCH=true` blocks all external actions instantly
- **Dry-run**: `DRY_RUN=true` records what would happen without executing
- **Policy validation**: Pre-execution business rule checks
- **Audit trail**: Every operation recorded with input, output, status

### Policy Guards (`utils/policyGuards.js`)

Deterministic business rules that run before external actions:
- Email format validation
- Send window enforcement (8 AM - 6 PM)
- Compliance/suppression checks
- Content presence required before delivery
- Job must be in DELIVERED state before invoicing
- Invoice amount cap ($10,000)

### Quality Gates (`utils/qualityGates.js`)

Content validation before delivery:
- Detects unresolved placeholders ([INSERT], {{template}}, etc.)
- Catches banned claims (guaranteed results, risk-free, etc.)
- Enforces minimum content length
- Checks for required sections

### Daily Summary (`utils/dailySummary.js`)

Operator visibility endpoint: `GET /api/operator/daily-summary`

Shows: operations completed/failed/blocked/deduped, jobs processed, invoices generated, system health status.

## Operator Controls

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/operator/kill-switch` | POST | Toggle global kill switch |
| `/api/operator/dry-run` | POST | Toggle dry-run/shadow mode |
| `/api/operator/daily-summary` | GET | Daily activity summary |
| `/api/operator/operations` | GET | Recent operations audit log |
| `/api/operator/job/:id/operations` | GET | Per-job operation history |

## Environment Variables for Autonomous Mode

```bash
# Safety controls
KILL_SWITCH=false          # Set true to block all external actions
DRY_RUN=false              # Set true for shadow mode (log but don't execute)
SHADOW_MODE=false          # Alias for DRY_RUN

# Required for production autonomous operation
MOCK_MODE=false
JWT_SECRET=<strong-random-secret>
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
```

## Recommended Startup Sequence

1. Start in dry-run mode: `DRY_RUN=true npm start`
2. Submit a test job, verify it flows through pipeline
3. Check `/api/operator/daily-summary` for recorded operations
4. Review operations: did it want to send the right emails, invoices?
5. Disable dry-run: `POST /api/operator/dry-run` with `{"enabled": false}`
6. Monitor for 24h with kill switch ready
7. Operate normally with periodic summary checks

## What Could Still Go Wrong

- **Storage corruption**: JSON file storage is single-process safe but not crash-proof. A kill -9 during a write could corrupt a file. Mitigation: backups exist in observability module.
- **Provider failures**: Real Gmail/Anthropic API errors are caught and logged but not automatically retried at the operation level (job-level retries handle this).
- **Clock drift**: Send window enforcement uses local server time.
- **Rate limit race**: High concurrency could exceed rate limits before the compliance mutex catches up. Mitigation: single-process Node.js makes this unlikely.

## Test Coverage

934 tests passing, including 35 autonomy-specific scenario tests covering:
- Duplicate operation prevention
- Kill switch enforcement
- Dry-run mode behavior
- Policy guard validation
- Quality gate content checks
- Daily summary accuracy
