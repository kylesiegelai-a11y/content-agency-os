# Content Agency OS

Automated content creation and agency management system powered by AI agents.

**Status:** Prototype / Demo — functional in mock mode, real integrations require API credentials.

## What It Does

Content Agency OS orchestrates a multi-agent pipeline for content agencies:

1. **Acquire** — Source opportunities via forms, Gmail, CSV imports, referrals, or marketplace integrations
2. **Score and Qualify** — AI-powered opportunity scoring with configurable thresholds
3. **Produce** — Multi-agent content pipeline: research, write, edit, humanize, quality gate
4. **Deliver** — Format output (Markdown, PDF, HTML, Google Docs) and track delivery
5. **Manage** — Scheduling, billing, compliance tracking, and a React dashboard

## Prerequisites

- Node.js >= 16
- npm

For production: Redis (for Bull queues) + API credentials (see .env.example).

## Quick Start (Mock Mode)

    git clone https://github.com/kylesiegelai-a11y/content-agency-os.git
    cd content-agency-os
    npm install
    cp .env.example .env
    npm run dev
    open http://localhost:3001

## Available Scripts

- npm run dev — Start in mock mode with hot reload
- npm start — Start in production mode (requires config)
- npm test — Run Jest test suite
- npm run lint — Run ESLint
- npm run build — Build the React dashboard
- npm run preflight — Pre-deployment checks

## Mock Mode vs Production

In mock mode (MOCK_MODE=true): all external services use in-memory mock providers, queues run in-memory (no Redis), auth uses auto-bootstrapped credentials, scheduler stubs return demo data.

In production (MOCK_MODE=false): requires Redis, API keys, and real credentials. Mock-only sources are blocked. Startup validation enforces secure JWT secret.

## Testing

    npm test
    npx jest --verbose
    npx jest tests/unit/
    npx jest tests/integration/

## Known Limitations

- Scheduler data-fetching methods return demo stub data
- Upwork marketplace source has no real provider; mock-only
- Queue dashboard metrics are approximations in mock mode
- No CI pipeline configured yet

## Security Notes

- Never commit .env — it is gitignored
- Run node scripts/initPassword.js to set a strong admin password
- JWT secrets are enforced at startup in production mode
- API keys are hashed with bcrypt before storage
- Rate limiting protects the login endpoint (5 attempts / 15 min)

## License

MIT
