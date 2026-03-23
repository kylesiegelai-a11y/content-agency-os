#!/usr/bin/env bash
# ─────────────────────────────────────────────────
# Content Agency OS — Pre-Ship Preflight Check
# Run this before every release to verify the system
# is in a shippable state.
#
# Usage:  bash scripts/preflight.sh
# ─────────────────────────────────────────────────
set -euo pipefail

PASS=0
FAIL=0
PORT=${PORT:-3001}

pass() { echo "  ✓ $1"; PASS=$((PASS + 1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL + 1)); }

echo ""
echo "══════════════════════════════════════════════"
echo "  Content Agency OS — Preflight Check"
echo "══════════════════════════════════════════════"
echo ""

# ── 1. Install ──────────────────────────────────
echo "▸ Step 1: Install dependencies"
if npm ci --silent 2>/dev/null; then
  pass "npm ci succeeded"
else
  fail "npm ci failed"
fi

# ── 2. Build ────────────────────────────────────
echo "▸ Step 2: Build dashboard"
if npm run build --silent 2>/dev/null; then
  pass "npm run build succeeded"
else
  fail "npm run build failed"
fi

# ── 3. Tests ────────────────────────────────────
echo "▸ Step 3: Run test suite"
if npm test -- --runInBand 2>/dev/null; then
  pass "All tests passed"
else
  fail "Tests failed"
fi

# ── 4. Mock server smoke test ───────────────────
echo "▸ Step 4: Mock server smoke test"

# Start server in background
MOCK_MODE=true node server.js &
SERVER_PID=$!
sleep 2

# Check health
if curl -sf http://localhost:$PORT/api/health > /dev/null 2>&1; then
  pass "GET /api/health returned 200"
else
  fail "GET /api/health did not respond"
fi

# Login
TOKEN=$(curl -sf -X POST http://localhost:$PORT/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"admin123"}' 2>/dev/null | node -e "process.stdin.on('data',d=>{try{console.log(JSON.parse(d).token)}catch(e){}})" 2>/dev/null || echo "")

if [ -n "$TOKEN" ]; then
  pass "Mock login returned a token"
else
  fail "Mock login failed"
fi

# Create a job
if [ -n "$TOKEN" ]; then
  CREATE_RESP=$(curl -sf -X POST http://localhost:$PORT/api/jobs \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"type":"content","priority":50,"data":{"client":"Preflight","topic":"Test Job"}}' 2>/dev/null || echo "")

  if echo "$CREATE_RESP" | grep -q '"success":true'; then
    pass "POST /api/jobs created a job"
  else
    fail "POST /api/jobs did not succeed"
  fi

  # List jobs
  LIST_RESP=$(curl -sf http://localhost:$PORT/api/jobs \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo "")

  if echo "$LIST_RESP" | grep -q '"jobs"'; then
    pass "GET /api/jobs returned jobs array"
  else
    fail "GET /api/jobs did not return expected shape"
  fi
fi

# Cleanup
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

# ── Summary ─────────────────────────────────────
echo ""
echo "──────────────────────────────────────────────"
echo "  Results: $PASS passed, $FAIL failed"
echo "──────────────────────────────────────────────"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "  ⚠  Preflight FAILED — fix issues before shipping"
  exit 1
else
  echo "  ✔  Preflight PASSED — ready to ship"
  exit 0
fi
