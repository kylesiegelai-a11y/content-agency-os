# Acquisition Engine Architecture

## Why Source-Agnostic Acquisition

The original system was built around a single acquisition channel (Upwork), with mock data silently substituted when no real results were available. This created several problems:

1. **False positives**: Sample opportunities were fabricated in production, making the pipeline appear active when it wasn't.
2. **Single point of failure**: The entire acquisition flow depended on one marketplace connector.
3. **No growth path**: Adding new lead channels (forms, referrals, email) required ad-hoc integration.

The new acquisition engine treats all lead sources as pluggable modules that conform to a shared interface. Upwork is now one optional connector among many. The system is useful even with zero marketplace connectors enabled.

## Production Safety Guarantees

1. **No fabricated opportunities in production.** If no sources return data, the system reports zero results honestly. The `generateSampleOpportunities()` function has been removed from the research agent.

2. **No silent mock fallback.** In production mode (MOCK_MODE=false), mock-only sources are blocked by the SourceRegistry. The serviceFactory no longer silently returns UpworkMock in production. If a source is unavailable, it fails with a structured error.

3. **Strict production enforcement.** ACQUISITION_STRICT_PRODUCTION (default: true) prevents mock-only sources from registering in production. Each source reports its health and availability clearly.

## Architecture Overview

```
Inbound Sources          Acquisition Engine           Storage
--------------          ------------------           -------
Form/Webhook  ──┐
Gmail Inbox   ──┤       ┌──────────────┐
CSV Import    ──┼──────>│ Source        │
Referral      ──┤       │ Registry     │
Marketplace   ──┘       └──────┬───────┘
                               │ fetch + normalize
                        ┌──────▼───────┐
                        │ Scoring &    │
                        │ Qualification│
                        └──────┬───────┘
                               │ score + classify
                        ┌──────▼───────┐
                        │ Deduplication│
                        └──────┬───────┘
                               │ unique only
                        ┌──────▼───────┐
                        │ Persistence  │──────> opportunities.json
                        │ & Metrics    │──────> acquisition_events.json
                        └──────────────┘
```

## Core Components

### AcquisitionSource (base class)
Every source extends this and implements:
- `fetchOpportunities(params)` — returns raw payloads
- `normalizeOpportunity(raw)` — converts to standard schema
- `validatePayload(raw)` — checks raw data before normalization

### SourceRegistry
Manages source lifecycle. Knows which sources are enabled, mock-only, or errored. In strict production mode, refuses to register mock-only sources.

### Scoring Pipeline
Deterministic, weighted scoring across 6 dimensions: content fit, budget fit, service fit, urgency, completeness, and confidence. Returns explainable reasons for every score. Classifies into: qualified (>=65), needs_review (40-64), rejected (<40).

### Deduplication
Deterministic cross-source dedup using SHA-256 keys from normalized email + company + title. Also performs fuzzy matching (Jaccard similarity on title words, email/company exact match) with configurable threshold (default 0.8).

### AcquisitionEngine
Main orchestrator. Runs the full pipeline: fetch → normalize → score → dedupe → persist. Also supports single-opportunity ingestion (for push sources like forms) and manual review of needs_review items.

## Opportunity Lifecycle

```
NEW → NORMALIZED → SCORED → QUALIFIED → (enters job pipeline)
                          → NEEDS_REVIEW → (manual approve/reject)
                          → REJECTED
                          → DUPLICATE
```

## Source Configuration

Each source can be enabled/disabled via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| ENABLE_ACQUISITION_FORM_SOURCE | true | Accept form/webhook submissions |
| ENABLE_ACQUISITION_GMAIL_SOURCE | true | Parse leads from labeled emails |
| ENABLE_ACQUISITION_IMPORT_SOURCE | true | CSV/JSON bulk import |
| ENABLE_ACQUISITION_REFERRAL_SOURCE | true | Partner referral ingestion |
| ENABLE_ACQUISITION_UPWORK_SOURCE | true | Marketplace connector |
| ACQUISITION_STRICT_PRODUCTION | true | Block mock sources in production |

## Human Review

Opportunities scoring between 40-64 are marked `needs_review`. The API provides:
- `GET /api/acquisition/opportunities?status=needs_review` — list reviewable items
- `POST /api/acquisition/opportunities/:id/review` — approve or reject with notes

Review decisions are recorded with timestamps in the opportunity metadata.

## How to Add a New Acquisition Source

1. Create a new file in `acquisition/sources/` extending `AcquisitionSource`
2. Implement `fetchOpportunities()`, `normalizeOpportunity()`, and `validatePayload()`
3. Register in `acquisition/setup.js` with appropriate config
4. Add an `ENABLE_ACQUISITION_*_SOURCE` env var
5. Add tests in `tests/unit/`

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/acquisition/ingest/form | Submit form/webhook opportunity |
| POST | /api/acquisition/ingest/referral | Submit referral |
| POST | /api/acquisition/import/csv | Import CSV or JSON opportunities |
| POST | /api/acquisition/cycle | Run full acquisition cycle |
| GET | /api/acquisition/opportunities | List with filters |
| GET | /api/acquisition/opportunities/:id | Get details |
| POST | /api/acquisition/opportunities/:id/review | Approve/reject |
| GET | /api/acquisition/sources | Source health status |
| GET | /api/acquisition/metrics | Acquisition metrics |

## Testing

Acquisition tests are in:
- `tests/unit/acquisition-core.test.js` — schema, registry, scoring, dedupe (72 tests)
- `tests/unit/acquisition-sources.test.js` — all 5 sources, engine integration, production safeguards (64 tests)

Run with: `npx jest tests/unit/acquisition`
