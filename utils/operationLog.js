/**
 * Operation Log — Durable idempotent execution ledger for external actions.
 *
 * Every money-impacting or client-facing action gets a deterministic operation ID.
 * The lifecycle is:
 *   1. Derive deterministic idempotency key
 *   2. Check kill switch / dry-run / policy guards
 *   3. PRE-WRITE durable record with status EXECUTING *before* side-effect
 *   4. Run external side-effect
 *   5. Update to COMPLETED / FAILED
 *   6. On restart, reconcile stale EXECUTING → RECOVERY_REQUIRED
 *
 * Storage: SQLite when USE_SQLITE=true (operations table), JSON file fallback.
 * The pre-write ensures that if the process crashes after the side-effect but
 * before the completion write, the operation is detectable on restart.
 */

const { v4: uuidv4 } = require('uuid');
const logger = require('./logger');

// Read live on every call — NOT cached at module load.
const IS_DRY_RUN = () => process.env.DRY_RUN === 'true' || process.env.SHADOW_MODE === 'true';
const KILL_SWITCH = () => process.env.KILL_SWITCH === 'true';
const USE_SQLITE = () => process.env.USE_SQLITE === 'true';

// Stale threshold for recovery (default: 5 minutes)
const STALE_THRESHOLD_MS = parseInt(process.env.OP_STALE_THRESHOLD_MS, 10) || 5 * 60 * 1000;

/**
 * Operation statuses
 */
const OP_STATUS = {
  PENDING: 'pending',
  EXECUTING: 'executing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  BLOCKED: 'blocked',
  DRY_RUN: 'dry_run',
  KILLED: 'killed',
  DUPLICATE: 'duplicate',
  RECOVERY_REQUIRED: 'recovery_required'
};

// ── SQLite accessor (lazy-loaded) ────────────────────────────────────

let _opsDb = null;
function getOpsDb() {
  if (!_opsDb) {
    const database = require('./database');
    _opsDb = database.operations;
  }
  return _opsDb;
}

// ── JSON fallback (for non-SQLite mode / tests) ─────────────────────

const { readData, writeData } = require('./storage');
const OPERATIONS_FILE = 'operations.json';

async function jsonLoadOps() {
  const data = await readData(OPERATIONS_FILE);
  if (!data || !data.operations) return { operations: [] };
  return data;
}

async function jsonSaveOps(data) {
  if (data.operations.length > 5000) {
    data.operations = data.operations.slice(-5000);
  }
  await writeData(OPERATIONS_FILE, data);
}

async function jsonInsertOp(record) {
  const data = await jsonLoadOps();
  // Check for existing idempotency key
  const existing = data.operations.find(op => op.idempotencyKey === record.idempotencyKey
    && (op.status === OP_STATUS.COMPLETED || op.status === OP_STATUS.EXECUTING));
  if (existing) return false; // duplicate
  data.operations.push(record);
  await jsonSaveOps(data);
  return true;
}

async function jsonUpdateOp(operationId, status, result, completedAt) {
  const data = await jsonLoadOps();
  const op = data.operations.find(o => o.operationId === operationId);
  if (!op) return false;
  op.status = status;
  op.result = result;
  op.completedAt = completedAt;
  op.updatedAt = new Date().toISOString();
  await jsonSaveOps(data);
  return true;
}

async function jsonFindByKey(idempotencyKey) {
  const data = await jsonLoadOps();
  return data.operations.find(
    op => op.idempotencyKey === idempotencyKey
      && (op.status === OP_STATUS.COMPLETED || op.status === OP_STATUS.EXECUTING)
  ) || null;
}

async function jsonFindStale(thresholdIso) {
  const data = await jsonLoadOps();
  return data.operations.filter(
    op => (op.status === OP_STATUS.PENDING || op.status === OP_STATUS.EXECUTING)
      && op.createdAt < thresholdIso
  );
}

async function jsonMarkStaleAsRecovery(thresholdIso) {
  const data = await jsonLoadOps();
  let count = 0;
  const now = new Date().toISOString();
  for (const op of data.operations) {
    if ((op.status === OP_STATUS.PENDING || op.status === OP_STATUS.EXECUTING)
        && op.createdAt < thresholdIso) {
      op.status = OP_STATUS.RECOVERY_REQUIRED;
      op.updatedAt = now;
      count++;
    }
  }
  if (count > 0) await jsonSaveOps(data);
  return count;
}

// ── Unified storage interface ────────────────────────────────────────

function storageInsert(record) {
  if (USE_SQLITE()) {
    return getOpsDb().insert(record);
  }
  return jsonInsertOp(record);
}

function storageUpdate(operationId, status, result, completedAt) {
  if (USE_SQLITE()) {
    return getOpsDb().updateStatus(operationId, status, result, completedAt);
  }
  return jsonUpdateOp(operationId, status, result, completedAt);
}

function storageFindByKey(idempotencyKey) {
  if (USE_SQLITE()) {
    return getOpsDb().findByIdempotencyKey(idempotencyKey);
  }
  return jsonFindByKey(idempotencyKey);
}

// ── Key generation ───────────────────────────────────────────────────

/**
 * Generate a stable idempotency key for an operation.
 * Same inputs = same key = deduplicated.
 */
function makeIdempotencyKey(actionType, jobId, target, qualifier = '') {
  return `${actionType}:${jobId}:${target}:${qualifier}`.toLowerCase().replace(/\s+/g, '_');
}

// ── Input/result sanitization ────────────────────────────────────────

function summarizeInput(input) {
  if (!input || typeof input !== 'object') return {};
  const summary = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string' && value.length > 200) {
      summary[key] = value.slice(0, 200) + '...[truncated]';
    } else if (typeof value === 'object' && value !== null) {
      summary[key] = '[object]';
    } else {
      summary[key] = value;
    }
  }
  return summary;
}

function sanitizeResult(result) {
  if (!result || typeof result !== 'object') return result;
  const safe = {};
  for (const [key, value] of Object.entries(result)) {
    if (/secret|token|password|key|body|content/i.test(key)) {
      safe[key] = '[redacted]';
    } else if (typeof value === 'string' && value.length > 500) {
      safe[key] = value.slice(0, 500) + '...[truncated]';
    } else {
      safe[key] = value;
    }
  }
  return safe;
}

// ── Main execution entry point ───────────────────────────────────────

/**
 * Execute an external action with full safety guards and durable pre-write.
 *
 * @param {Object} params
 * @param {string} params.actionType
 * @param {string} params.jobId
 * @param {string} params.target
 * @param {string} [params.qualifier]
 * @param {Object} params.input
 * @param {Function} params.execute - Async function that performs the actual action
 * @param {Function} [params.validate] - Pre-execution validation
 * @returns {Object} Operation result record
 */
async function executeOperation(params) {
  const {
    actionType,
    jobId,
    target,
    qualifier = '',
    input = {},
    execute,
    validate
  } = params;

  const idempotencyKey = makeIdempotencyKey(actionType, jobId, target, qualifier);
  const operationId = `op_${uuidv4().slice(0, 12)}`;
  const now = new Date().toISOString();

  // 1. Check kill switch
  if (KILL_SWITCH()) {
    const record = makeRecord({
      operationId, idempotencyKey, actionType, jobId, target, qualifier,
      input, status: OP_STATUS.KILLED, now,
      result: { reason: 'Global kill switch is enabled' }
    });
    await storageInsert(record);
    logger.warn('[operationLog] Action blocked by kill switch', { operationId, actionType, jobId });
    return record;
  }

  // 2. Check for completed duplicate (idempotency)
  const existing = await storageFindByKey(idempotencyKey);
  if (existing && existing.status === OP_STATUS.COMPLETED) {
    logger.info('[operationLog] Duplicate operation prevented', {
      operationId, idempotencyKey, existingId: existing.operationId, actionType
    });
    const dupRecord = makeRecord({
      operationId, idempotencyKey, actionType, jobId, target, qualifier,
      input, status: OP_STATUS.DUPLICATE, now,
      result: { reason: 'Already completed', originalOperationId: existing.operationId }
    });
    // Don't persist duplicate markers — just return
    return dupRecord;
  }

  // 3. Run pre-execution validation (policy guards)
  if (validate) {
    try {
      const validation = await validate(input);
      if (!validation.allowed) {
        const record = makeRecord({
          operationId, idempotencyKey, actionType, jobId, target, qualifier,
          input, status: OP_STATUS.BLOCKED, now,
          result: { reason: validation.reason, check: validation.check || null }
        });
        await storageInsert(record);
        logger.warn('[operationLog] Action blocked by policy', { operationId, actionType, reason: validation.reason });
        return record;
      }
    } catch (valErr) {
      const record = makeRecord({
        operationId, idempotencyKey, actionType, jobId, target, qualifier,
        input, status: OP_STATUS.BLOCKED, now,
        result: { reason: `Validation error: ${valErr.message}` }
      });
      await storageInsert(record);
      logger.error('[operationLog] Validation error — action blocked', { operationId, error: valErr.message });
      return record;
    }
  }

  // 4. Dry-run check
  if (IS_DRY_RUN()) {
    const record = makeRecord({
      operationId, idempotencyKey, actionType, jobId, target, qualifier,
      input, status: OP_STATUS.DRY_RUN, now,
      result: { reason: 'Dry run mode — action not executed' }
    });
    await storageInsert(record);
    logger.info('[operationLog] DRY RUN — would execute', { operationId, actionType, jobId, target });
    return record;
  }

  // 5. *** DURABLE PRE-WRITE *** — persist EXECUTING before side-effect
  const preRecord = makeRecord({
    operationId, idempotencyKey, actionType, jobId, target, qualifier,
    input, status: OP_STATUS.EXECUTING, now
  });
  const inserted = await storageInsert(preRecord);
  if (!inserted) {
    // Another operation with this idempotency key already exists
    // (could be EXECUTING from a prior crash, or COMPLETED)
    const existingOp = await storageFindByKey(idempotencyKey);
    if (existingOp) {
      logger.info('[operationLog] Operation already in progress or completed', {
        operationId, idempotencyKey, existingStatus: existingOp.status
      });
      return {
        ...preRecord,
        status: OP_STATUS.DUPLICATE,
        result: { reason: `Existing operation: ${existingOp.status}`, originalOperationId: existingOp.operationId }
      };
    }
  }

  // 6. Execute the side-effect
  try {
    const result = await execute(input);
    const completedAt = new Date().toISOString();
    const sanitized = sanitizeResult(result);
    await storageUpdate(operationId, OP_STATUS.COMPLETED, sanitized, completedAt);
    logger.info('[operationLog] Operation completed', { operationId, actionType, jobId, target });
    return { ...preRecord, status: OP_STATUS.COMPLETED, result: sanitized, completedAt };
  } catch (execErr) {
    const completedAt = new Date().toISOString();
    const errResult = { error: execErr.message };
    await storageUpdate(operationId, OP_STATUS.FAILED, errResult, completedAt);
    logger.error('[operationLog] Operation failed', { operationId, actionType, jobId, error: execErr.message });
    return { ...preRecord, status: OP_STATUS.FAILED, result: errResult, completedAt };
  }
}

function makeRecord({ operationId, idempotencyKey, actionType, jobId, target, qualifier, input, status, now, result }) {
  return {
    operationId,
    idempotencyKey,
    actionType,
    jobId,
    target,
    qualifier: qualifier || null,
    inputSummary: summarizeInput(input),
    status,
    result: result || null,
    dryRun: IS_DRY_RUN(),
    createdAt: now,
    startedAt: status === OP_STATUS.EXECUTING ? now : null,
    completedAt: null,
    updatedAt: now
  };
}

// ── Recovery / reconciliation ────────────────────────────────────────

/**
 * Startup reconciliation: find stale PENDING/EXECUTING operations and
 * mark them as RECOVERY_REQUIRED. Does NOT automatically retry — the
 * operator must review these because the side-effect may already have
 * been sent (email, invoice, etc.).
 *
 * @returns {Object} { staleCount, markedCount, operations[] }
 */
async function reconcileStaleOperations() {
  const threshold = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();

  if (USE_SQLITE()) {
    const stale = getOpsDb().findStale(threshold);
    const markedCount = getOpsDb().markStaleAsRecovery(threshold);
    logger.info('[operationLog] Startup reconciliation complete', {
      staleCount: stale.length, markedCount
    });
    return { staleCount: stale.length, markedCount, operations: stale };
  }

  // JSON fallback
  const stale = await jsonFindStale(threshold);
  const markedCount = await jsonMarkStaleAsRecovery(threshold);
  logger.info('[operationLog] Startup reconciliation complete', {
    staleCount: stale.length, markedCount
  });
  return { staleCount: stale.length, markedCount, operations: stale };
}

/**
 * List operations that need manual operator review.
 */
async function getRecoveryRequired() {
  if (USE_SQLITE()) {
    return getOpsDb().listByStatus(OP_STATUS.RECOVERY_REQUIRED);
  }
  const data = await jsonLoadOps();
  return data.operations.filter(op => op.status === OP_STATUS.RECOVERY_REQUIRED);
}

// ── Query helpers (used by operator endpoints) ───────────────────────

async function checkDuplicate(idempotencyKey) {
  return storageFindByKey(idempotencyKey);
}

async function getDailySummary(dateStr = null) {
  const today = dateStr || new Date().toISOString().slice(0, 10);

  if (USE_SQLITE()) {
    const { byStatus, byType } = getOpsDb().dailySummary(today);
    const total = Object.values(byStatus).reduce((s, v) => s + v, 0);
    return {
      date: today,
      total,
      completed: byStatus.completed || 0,
      failed: byStatus.failed || 0,
      blocked: byStatus.blocked || 0,
      duplicatesPrevented: byStatus.duplicate || 0,
      dryRuns: byStatus.dry_run || 0,
      killed: byStatus.killed || 0,
      recoveryRequired: byStatus.recovery_required || 0,
      byType
    };
  }

  // JSON fallback
  const data = await jsonLoadOps();
  const ops = data.operations.filter(op => op.createdAt && op.createdAt.startsWith(today));
  return {
    date: today,
    total: ops.length,
    completed: ops.filter(op => op.status === OP_STATUS.COMPLETED).length,
    failed: ops.filter(op => op.status === OP_STATUS.FAILED).length,
    blocked: ops.filter(op => op.status === OP_STATUS.BLOCKED).length,
    duplicatesPrevented: ops.filter(op => op.status === OP_STATUS.DUPLICATE).length,
    dryRuns: ops.filter(op => op.status === OP_STATUS.DRY_RUN).length,
    killed: ops.filter(op => op.status === OP_STATUS.KILLED).length,
    recoveryRequired: ops.filter(op => op.status === OP_STATUS.RECOVERY_REQUIRED).length,
    byType: ops.reduce((acc, op) => {
      acc[op.actionType] = (acc[op.actionType] || 0) + 1;
      return acc;
    }, {})
  };
}

async function getJobOperations(jobId) {
  if (USE_SQLITE()) {
    return getOpsDb().listByJob(jobId);
  }
  const data = await jsonLoadOps();
  return data.operations.filter(op => op.jobId === jobId);
}

async function getRecentOperations(limit = 50) {
  if (USE_SQLITE()) {
    return getOpsDb().listRecent(limit);
  }
  const data = await jsonLoadOps();
  return data.operations.slice(-limit).reverse();
}

module.exports = {
  executeOperation,
  checkDuplicate,
  makeIdempotencyKey,
  getDailySummary,
  getJobOperations,
  getRecentOperations,
  reconcileStaleOperations,
  getRecoveryRequired,
  OP_STATUS,
  IS_DRY_RUN,
  STALE_THRESHOLD_MS
};
