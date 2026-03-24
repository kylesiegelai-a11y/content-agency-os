/**
 * Operation Log — Idempotent execution ledger for external actions.
 *
 * Every money-impacting or client-facing action gets an operation ID.
 * Before executing, we check if the operation already completed.
 * After executing, we record the result.
 *
 * This prevents duplicate emails, invoices, deliveries on retry/crash.
 */

const { v4: uuidv4 } = require('uuid');
const { readData, writeData } = require('./storage');
const logger = require('./logger');

const OPERATIONS_FILE = 'operations.json';
const DRY_RUN = process.env.DRY_RUN === 'true' || process.env.SHADOW_MODE === 'true';
const KILL_SWITCH = () => process.env.KILL_SWITCH === 'true';

/**
 * Operation statuses
 */
const OP_STATUS = {
  PENDING: 'pending',
  EXECUTING: 'executing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  BLOCKED: 'blocked',      // blocked by policy
  DRY_RUN: 'dry_run',      // would have executed but dry-run mode
  KILLED: 'killed',         // blocked by kill switch
  DUPLICATE: 'duplicate'    // already completed
};

/**
 * Load operations ledger
 */
async function loadOperations() {
  const data = await readData(OPERATIONS_FILE);
  if (!data || !data.operations) return { operations: [] };
  return data;
}

/**
 * Save operations ledger
 */
async function saveOperations(data) {
  await writeData(OPERATIONS_FILE, data);
}

/**
 * Generate a stable idempotency key for an operation.
 * Same inputs = same key = deduplicated.
 *
 * @param {string} actionType - e.g. 'email_send', 'delivery', 'invoice_generate'
 * @param {string} jobId - The job this operation belongs to
 * @param {string} target - Target entity (email address, client ID, etc.)
 * @param {string} [qualifier] - Additional qualifier (e.g. campaign stage, format)
 * @returns {string} Deterministic idempotency key
 */
function makeIdempotencyKey(actionType, jobId, target, qualifier = '') {
  return `${actionType}:${jobId}:${target}:${qualifier}`.toLowerCase().replace(/\s+/g, '_');
}

/**
 * Check if an operation has already been completed.
 * Returns the existing operation record if found, null otherwise.
 */
async function checkDuplicate(idempotencyKey) {
  const data = await loadOperations();
  return data.operations.find(
    op => op.idempotencyKey === idempotencyKey && op.status === OP_STATUS.COMPLETED
  ) || null;
}

/**
 * Execute an external action with full safety guards.
 *
 * This is the MAIN entry point for any external action.
 *
 * @param {Object} params
 * @param {string} params.actionType - Type of action (email_send, delivery, invoice_generate, notification)
 * @param {string} params.jobId - Associated job ID
 * @param {string} params.target - Target entity
 * @param {string} [params.qualifier] - Additional dedup qualifier
 * @param {Object} params.input - Input data summary (for audit)
 * @param {Function} params.execute - Async function that performs the actual action. Receives (input).
 * @param {Function} [params.validate] - Async pre-execution validation. Returns {allowed: bool, reason: string}
 * @returns {Object} Operation result
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
  const startedAt = new Date().toISOString();

  // 1. Check kill switch
  if (KILL_SWITCH()) {
    const record = createOperationRecord({
      operationId, idempotencyKey, actionType, jobId, target, qualifier,
      input, status: OP_STATUS.KILLED, startedAt,
      result: { reason: 'Global kill switch is enabled' }
    });
    await persistOperation(record);
    logger.warn('[operationLog] Action blocked by kill switch', { operationId, actionType, jobId });
    return record;
  }

  // 2. Check for duplicate (idempotency)
  const existing = await checkDuplicate(idempotencyKey);
  if (existing) {
    logger.info('[operationLog] Duplicate operation prevented', {
      operationId, idempotencyKey, existingId: existing.operationId, actionType
    });
    const dupRecord = createOperationRecord({
      operationId, idempotencyKey, actionType, jobId, target, qualifier,
      input, status: OP_STATUS.DUPLICATE, startedAt,
      result: { reason: 'Already completed', originalOperationId: existing.operationId }
    });
    await persistOperation(dupRecord);
    return dupRecord;
  }

  // 3. Run pre-execution validation (policy guards)
  if (validate) {
    try {
      const validation = await validate(input);
      if (!validation.allowed) {
        const record = createOperationRecord({
          operationId, idempotencyKey, actionType, jobId, target, qualifier,
          input, status: OP_STATUS.BLOCKED, startedAt,
          result: { reason: validation.reason, check: validation.check || null }
        });
        await persistOperation(record);
        logger.warn('[operationLog] Action blocked by policy', { operationId, actionType, reason: validation.reason });
        return record;
      }
    } catch (valErr) {
      // Fail closed — if validation itself errors, block the action
      const record = createOperationRecord({
        operationId, idempotencyKey, actionType, jobId, target, qualifier,
        input, status: OP_STATUS.BLOCKED, startedAt,
        result: { reason: `Validation error: ${valErr.message}` }
      });
      await persistOperation(record);
      logger.error('[operationLog] Validation error — action blocked', { operationId, error: valErr.message });
      return record;
    }
  }

  // 4. Dry run check
  if (DRY_RUN) {
    const record = createOperationRecord({
      operationId, idempotencyKey, actionType, jobId, target, qualifier,
      input, status: OP_STATUS.DRY_RUN, startedAt,
      result: { reason: 'Dry run mode — action not executed' }
    });
    await persistOperation(record);
    logger.info('[operationLog] DRY RUN — would execute', { operationId, actionType, jobId, target });
    return record;
  }

  // 5. Execute the action
  const record = createOperationRecord({
    operationId, idempotencyKey, actionType, jobId, target, qualifier,
    input, status: OP_STATUS.EXECUTING, startedAt
  });

  try {
    const result = await execute(input);
    record.status = OP_STATUS.COMPLETED;
    record.result = sanitizeResult(result);
    record.completedAt = new Date().toISOString();
    await persistOperation(record);
    logger.info('[operationLog] Operation completed', { operationId, actionType, jobId, target });
    return record;
  } catch (execErr) {
    record.status = OP_STATUS.FAILED;
    record.result = { error: execErr.message };
    record.completedAt = new Date().toISOString();
    await persistOperation(record);
    logger.error('[operationLog] Operation failed', { operationId, actionType, jobId, error: execErr.message });
    return record;
  }
}

function createOperationRecord({ operationId, idempotencyKey, actionType, jobId, target, qualifier, input, status, startedAt, result }) {
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
    startedAt,
    completedAt: null,
    dryRun: DRY_RUN
  };
}

function summarizeInput(input) {
  if (!input || typeof input !== 'object') return {};
  // Strip large content fields, keep metadata
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
    // Never log secrets, tokens, or full email bodies
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

async function persistOperation(record) {
  try {
    const data = await loadOperations();
    data.operations.push(record);
    // Keep last 5000 operations (rolling window)
    if (data.operations.length > 5000) {
      data.operations = data.operations.slice(-5000);
    }
    await saveOperations(data);
  } catch (err) {
    // Last resort — log to stderr so it's not silently lost
    logger.error('[operationLog] CRITICAL: Failed to persist operation record', {
      operationId: record.operationId,
      error: err.message
    });
  }
}

/**
 * Get daily operation summary for the operator.
 */
async function getDailySummary(dateStr = null) {
  const today = dateStr || new Date().toISOString().slice(0, 10);
  const data = await loadOperations();
  const ops = data.operations.filter(op => op.startedAt && op.startedAt.startsWith(today));

  return {
    date: today,
    total: ops.length,
    completed: ops.filter(op => op.status === OP_STATUS.COMPLETED).length,
    failed: ops.filter(op => op.status === OP_STATUS.FAILED).length,
    blocked: ops.filter(op => op.status === OP_STATUS.BLOCKED).length,
    duplicatesPrevented: ops.filter(op => op.status === OP_STATUS.DUPLICATE).length,
    dryRuns: ops.filter(op => op.status === OP_STATUS.DRY_RUN).length,
    killed: ops.filter(op => op.status === OP_STATUS.KILLED).length,
    byType: ops.reduce((acc, op) => {
      acc[op.actionType] = (acc[op.actionType] || 0) + 1;
      return acc;
    }, {}),
    recentErrors: ops.filter(op => op.status === OP_STATUS.FAILED).slice(-10).map(op => ({
      operationId: op.operationId,
      actionType: op.actionType,
      jobId: op.jobId,
      error: op.result?.error
    }))
  };
}

/**
 * Query operations for a specific job (audit trail).
 */
async function getJobOperations(jobId) {
  const data = await loadOperations();
  return data.operations.filter(op => op.jobId === jobId);
}

module.exports = {
  executeOperation,
  checkDuplicate,
  makeIdempotencyKey,
  getDailySummary,
  getJobOperations,
  OP_STATUS,
  DRY_RUN
};
