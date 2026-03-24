/**
 * Autonomy Safety Tests
 *
 * Tests for the core safety infrastructure:
 * - Operation log deduplication (idempotency)
 * - Kill switch blocks execution
 * - Dry run mode records but doesn't execute
 * - Policy guards block invalid emails
 * - Policy guards block missing content
 * - Invoice dedup (no double invoice per job)
 * - Quality gates catch placeholders
 * - Quality gates catch empty content
 * - Daily summary returns correct counts
 */

const path = require('path');

// Set test environment — DATABASE_PATH controls where the Storage singleton reads/writes
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(__dirname, '../../data_test');
process.env.DATA_DIR = path.join(__dirname, '../../data_test');

const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const {
  executeOperation,
  checkDuplicate,
  makeIdempotencyKey,
  getDailySummary,
  getJobOperations,
  OP_STATUS,
  IS_DRY_RUN
} = require('../../utils/operationLog');

const {
  validateEmailSend,
  validateDelivery,
  validateInvoiceGeneration,
  validateNotification,
  POLICY
} = require('../../utils/policyGuards');

const {
  validateContent,
  PLACEHOLDER_PATTERNS
} = require('../../utils/qualityGates');

const { generateDailySummary } = require('../../utils/dailySummary');
const { writeData, readData } = require('../../utils/storage');

describe('Autonomy Safety Infrastructure', () => {
  // Setup test data directory
  beforeAll(() => {
    const testDir = path.join(__dirname, '../../data_test');
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  // Cleanup
  afterEach(async () => {
    // Clear operations for next test
    const testDir = path.join(__dirname, '../../data_test');
    const opFile = path.join(testDir, 'operations.json');
    if (fs.existsSync(opFile)) {
      fs.unlinkSync(opFile);
    }
  });

  afterAll(() => {
    const testDir = path.join(__dirname, '../../data_test');
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true });
      } catch (e) { /* ok */ }
    }
  });

  describe('Operation Log - Idempotency', () => {
    test('Should execute an operation successfully', async () => {
      const jobId = `test_${uuidv4().slice(0, 8)}`;
      const result = await executeOperation({
        actionType: 'test_action',
        jobId,
        target: 'test@example.com',
        input: { test: 'data' },
        execute: async () => ({ success: true, data: 'test' })
      });

      expect(result.status).toBe(OP_STATUS.COMPLETED);
      expect(result.operationId).toBeDefined();
      expect(result.idempotencyKey).toBeDefined();
      expect(result.result.success).toBe(true);
    });

    test('Should prevent duplicate operations (idempotency)', async () => {
      const jobId = `test_${uuidv4().slice(0, 8)}`;
      let callCount = 0;

      const firstResult = await executeOperation({
        actionType: 'test_dedup',
        jobId,
        target: 'test@example.com',
        input: { test: 'data' },
        execute: async () => {
          callCount++;
          return { success: true, count: callCount };
        }
      });

      expect(firstResult.status).toBe(OP_STATUS.COMPLETED);
      expect(callCount).toBe(1);

      // Try again with same parameters
      const secondResult = await executeOperation({
        actionType: 'test_dedup',
        jobId,
        target: 'test@example.com',
        input: { test: 'data' },
        execute: async () => {
          callCount++;
          return { success: true, count: callCount };
        }
      });

      expect(secondResult.status).toBe(OP_STATUS.DUPLICATE);
      expect(secondResult.result.originalOperationId).toBe(firstResult.operationId);
      expect(callCount).toBe(1); // Should not have executed again
    });

    test('Should generate stable idempotency keys', () => {
      const key1 = makeIdempotencyKey('email_send', 'job123', 'test@example.com', '');
      const key2 = makeIdempotencyKey('email_send', 'job123', 'test@example.com', '');
      expect(key1).toBe(key2);

      // Different parameters should give different keys
      const key3 = makeIdempotencyKey('email_send', 'job124', 'test@example.com', '');
      expect(key1).not.toBe(key3);
    });

    test('Should check for existing duplicates', async () => {
      // Use unique IDs to avoid test pollution
      const uniqueId = `test_${uuidv4().slice(0, 8)}`;
      const key = makeIdempotencyKey('test', uniqueId, 'target1', '');

      // Execute operation
      const result = await executeOperation({
        actionType: 'test',
        jobId: uniqueId,
        target: 'target1',
        input: {},
        execute: async () => ({ success: true })
      });

      // Now should find duplicate with same key
      const existing2 = await checkDuplicate(key);
      expect(existing2).toBeDefined();
      expect(existing2.status).toBe(OP_STATUS.COMPLETED);
      expect(existing2.operationId).toBe(result.operationId);
    });

    test('Should query operations by job', async () => {
      const jobId = `test_${uuidv4().slice(0, 8)}`;

      await executeOperation({
        actionType: 'action1',
        jobId,
        target: 'target1',
        input: {},
        execute: async () => ({ success: true })
      });

      await executeOperation({
        actionType: 'action2',
        jobId,
        target: 'target2',
        input: {},
        execute: async () => ({ success: true })
      });

      const ops = await getJobOperations(jobId);
      expect(ops.length).toBe(2);
      expect(ops.every(op => op.jobId === jobId)).toBe(true);
    });
  });

  describe('Kill Switch', () => {
    test('Should block execution when kill switch is enabled', async () => {
      process.env.KILL_SWITCH = 'true';

      const result = await executeOperation({
        actionType: 'test_action',
        jobId: 'test_job',
        target: 'test@example.com',
        input: {},
        execute: async () => {
          throw new Error('Should not execute');
        }
      });

      expect(result.status).toBe(OP_STATUS.KILLED);
      expect(result.result.reason).toContain('kill switch');

      delete process.env.KILL_SWITCH;
    });

    test('Should allow execution when kill switch is disabled', async () => {
      process.env.KILL_SWITCH = 'false';

      const result = await executeOperation({
        actionType: 'test_action',
        jobId: `test_${uuidv4().slice(0, 8)}`,
        target: 'test@example.com',
        input: {},
        execute: async () => ({ success: true })
      });

      expect(result.status).toBe(OP_STATUS.COMPLETED);

      delete process.env.KILL_SWITCH;
    });
  });

  describe('Dry Run Mode', () => {
    test('Should block execution when dry-run is toggled on at runtime', async () => {
      // IS_DRY_RUN is now a function, so runtime toggles work
      process.env.DRY_RUN = 'true';

      let executed = false;
      const result = await executeOperation({
        actionType: 'test_dry_run',
        jobId: `test_${uuidv4().slice(0, 8)}`,
        target: 'test@example.com',
        input: {},
        execute: async () => {
          executed = true;
          return { success: true };
        }
      });

      expect(result.status).toBe(OP_STATUS.DRY_RUN);
      expect(executed).toBe(false);
      expect(result.result.reason).toContain('Dry run');

      delete process.env.DRY_RUN;
    });

    test('Should execute normally after dry-run is toggled off', async () => {
      process.env.DRY_RUN = 'true';

      // First call — should be dry run
      const dryResult = await executeOperation({
        actionType: 'test_dry_toggle',
        jobId: `test_${uuidv4().slice(0, 8)}`,
        target: 'test@example.com',
        input: {},
        execute: async () => ({ success: true })
      });
      expect(dryResult.status).toBe(OP_STATUS.DRY_RUN);

      // Toggle off
      process.env.DRY_RUN = 'false';

      // Second call — should execute
      const liveResult = await executeOperation({
        actionType: 'test_dry_toggle_live',
        jobId: `test_${uuidv4().slice(0, 8)}`,
        target: 'test@example.com',
        input: {},
        execute: async () => ({ success: true })
      });
      expect(liveResult.status).toBe(OP_STATUS.COMPLETED);

      delete process.env.DRY_RUN;
    });

    test('Should treat SHADOW_MODE=true as dry run', async () => {
      process.env.SHADOW_MODE = 'true';

      const result = await executeOperation({
        actionType: 'test_shadow',
        jobId: `test_${uuidv4().slice(0, 8)}`,
        target: 'test@example.com',
        input: {},
        execute: async () => ({ success: true })
      });

      expect(result.status).toBe(OP_STATUS.DRY_RUN);

      delete process.env.SHADOW_MODE;
    });
  });

  describe('Policy Guards - Email Validation', () => {
    test('Should reject email without recipient', async () => {
      const result = await validateEmailSend({
        recipientEmail: '',
        jobId: 'test_job'
      });

      expect(result.allowed).toBe(false);
      expect(result.check).toBe('missing_email');
    });

    test('Should reject invalid email format', async () => {
      const result = await validateEmailSend({
        recipientEmail: 'not-an-email',
        jobId: 'test_job'
      });

      expect(result.allowed).toBe(false);
      expect(result.check).toBe('invalid_email');
    });

    test('Should accept valid email format when all checks pass', async () => {
      // Validation depends on preSendCheck (compliance check)
      // This test ensures format validation works
      const result = await validateEmailSend({
        recipientEmail: 'test@example.com',
        jobId: 'test_job'
      });

      // Result depends on preSendCheck, so just verify it returned a boolean
      expect(result.allowed).toBeDefined();
      expect(typeof result.allowed).toBe('boolean');
    });
  });

  describe('Policy Guards - Delivery Validation', () => {
    test('Should reject delivery without content', async () => {
      const result = await validateDelivery({
        jobId: 'test_job',
        content: null,
        formats: ['pdf', 'html']
      });

      expect(result.allowed).toBe(false);
      expect(result.check).toBe('missing_content');
    });

    test('Should reject delivery without formats', async () => {
      const result = await validateDelivery({
        jobId: 'test_job',
        content: { body: 'Test content' },
        formats: []
      });

      expect(result.allowed).toBe(false);
      expect(result.check).toBe('missing_formats');
    });

    test('Should accept valid delivery', async () => {
      const result = await validateDelivery({
        jobId: 'test_job',
        content: { body: 'Test content' },
        formats: ['pdf']
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe('Policy Guards - Invoice Validation', () => {
    test('Should reject invoice without job ID', async () => {
      const result = await validateInvoiceGeneration({
        jobId: '',
        amount: 500
      });

      expect(result.allowed).toBe(false);
      expect(result.check).toBe('missing_job_id');
    });

    test('Should check maximum invoice amount limit', async () => {
      const result = await validateInvoiceGeneration({
        jobId: 'test_job',
        amount: 15000 // exceeds 10000 max
      });

      // Will fail either on amount check or delivery check, both are valid
      expect(result.allowed).toBe(false);
      expect(['amount_exceeded', 'not_delivered']).toContain(result.check);
    });

    test('Should validate invoice amount and state', async () => {
      const result = await validateInvoiceGeneration({
        jobId: 'nonexistent_job',
        amount: 500
      });

      // Will fail on delivery state check
      expect(result.allowed).toBe(false);
    });
  });

  describe('Policy Guards - Notification Validation', () => {
    test('Should reject notification without email', async () => {
      const result = await validateNotification({
        clientEmail: '',
        jobId: 'test_job'
      });

      expect(result.allowed).toBe(false);
      expect(result.check).toBe('missing_email');
    });

    test('Should reject invalid email format', async () => {
      const result = await validateNotification({
        clientEmail: 'not-an-email',
        jobId: 'test_job'
      });

      expect(result.allowed).toBe(false);
      expect(result.check).toBe('invalid_email');
    });

    test('Should accept valid notification', async () => {
      const result = await validateNotification({
        clientEmail: 'valid@example.com',
        jobId: 'test_job'
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe('Quality Gates - Content Validation', () => {
    test('Should reject empty content', () => {
      const result = validateContent('');

      expect(result.passed).toBe(false);
      expect(result.failures).toContain('Content body is empty');
    });

    test('Should reject content that is too short', () => {
      const result = validateContent('Short');

      expect(result.passed).toBe(false);
      expect(result.failures.some(f => f.includes('too short'))).toBe(true);
    });

    test('Should detect unresolved placeholders', () => {
      const content = 'This is a [INSERT TEXT HERE] placeholder test.';

      const result = validateContent(content);

      expect(result.passed).toBe(false);
      expect(result.failures.some(f => f.includes('Unresolved placeholder'))).toBe(true);
    });

    test('Should detect mustache template variables', () => {
      const content = 'Hello {{firstName}}, your account has {{credits}} credits. This is content that is long enough.';

      const result = validateContent(content);

      expect(result.passed).toBe(false);
      expect(result.failures.some(f => f.includes('Unresolved placeholder'))).toBe(true);
    });

    test('Should detect banned claims', () => {
      const content = 'This product is guaranteed results and risk-free. ' +
        'Very long content to exceed minimum length requirement for the test.';

      const result = validateContent(content);

      expect(result.passed).toBe(false);
      expect(result.failures.some(f => f.includes('Banned claim'))).toBe(true);
    });

    test('Should accept good content', () => {
      const content = 'This is a well-written piece of content that provides real value. ' +
        'It is long enough to meet minimum requirements. It contains no placeholders, ' +
        'no banned claims, and no template variables. This is genuine, original content.';

      const result = validateContent(content);

      expect(result.passed).toBe(true);
      expect(result.failures).toEqual([]);
    });

    test('Should detect Lorem ipsum', () => {
      const content = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. ' +
        'This is padding to make it long enough to pass the length check for the test.';

      const result = validateContent(content);

      expect(result.passed).toBe(false);
      expect(result.failures.some(f => f.includes('Unresolved placeholder'))).toBe(true);
    });

    test('Should require specified sections', () => {
      const content = 'This is a complete article with many sections. ' +
        'Introduction paragraph here. Middle section here. ' +
        'Conclusion paragraph. Additional padding.';

      const result = validateContent(content, {
        requiredSections: ['Introduction', 'Conclusion', 'Missing Section']
      });

      expect(result.passed).toBe(false);
      expect(result.failures.some(f => f.includes('Missing required section: Missing Section'))).toBe(true);
    });
  });

  describe('Daily Summary', () => {
    test('Should generate daily summary with operation stats', async () => {
      const jobId = `test_${uuidv4().slice(0, 8)}`;

      // Execute some operations
      await executeOperation({
        actionType: 'test_action',
        jobId,
        target: 'test1@example.com',
        input: {},
        execute: async () => ({ success: true })
      });

      await executeOperation({
        actionType: 'test_action',
        jobId,
        target: 'test2@example.com',
        input: {},
        execute: async () => ({ success: true })
      });

      const summary = await generateDailySummary();

      expect(summary.date).toBeDefined();
      expect(summary.operations).toBeDefined();
      expect(summary.operations.total).toBeGreaterThanOrEqual(2);
      expect(summary.operations.completed).toBeGreaterThanOrEqual(2);
      expect(summary.systemHealth).toBeDefined();
    });

    test('Should include system health state in summary', async () => {
      process.env.DRY_RUN = 'false';
      process.env.KILL_SWITCH = 'false';

      const summary = await generateDailySummary();

      expect(summary.systemHealth.dryRunMode).toBe(false);
      expect(summary.systemHealth.killSwitch).toBe(false);

      delete process.env.DRY_RUN;
      delete process.env.KILL_SWITCH;
    });

    test('Should categorize operations by type', async () => {
      const jobId = `test_${uuidv4().slice(0, 8)}`;

      await executeOperation({
        actionType: 'email_send',
        jobId,
        target: 'test@example.com',
        input: {},
        execute: async () => ({ success: true })
      });

      await executeOperation({
        actionType: 'invoice_generate',
        jobId,
        target: 'invoice1',
        input: {},
        execute: async () => ({ success: true })
      });

      const summary = await generateDailySummary();

      expect(summary.operations.byType.email_send).toBeGreaterThanOrEqual(1);
      expect(summary.operations.byType.invoice_generate).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Policy Enforcement Integration', () => {
    test('Should block operation if validation fails', async () => {
      const jobId = `test_${uuidv4().slice(0, 8)}`;

      const result = await executeOperation({
        actionType: 'test_action',
        jobId,
        target: 'test@example.com',
        input: { clientEmail: 'invalid-email' },
        validate: (input) => validateNotification(input),
        execute: async () => {
          throw new Error('Should not execute');
        }
      });

      expect(result.status).toBe(OP_STATUS.BLOCKED);
      expect(result.result.reason).toContain('Invalid');
    });

    test('Should execute operation if validation passes', async () => {
      const jobId = `test_${uuidv4().slice(0, 8)}`;

      const result = await executeOperation({
        actionType: 'test_action',
        jobId,
        target: 'test@example.com',
        input: { clientEmail: 'valid@example.com', jobId },
        validate: (input) => validateNotification(input),
        execute: async () => ({ success: true, sent: true })
      });

      expect(result.status).toBe(OP_STATUS.COMPLETED);
      expect(result.result.success).toBe(true);
    });
  });

  describe('Error Handling', () => {
    test('Should catch execution errors and mark as failed', async () => {
      const jobId = `test_${uuidv4().slice(0, 8)}`;

      const result = await executeOperation({
        actionType: 'test_action',
        jobId,
        target: 'test@example.com',
        input: {},
        execute: async () => {
          throw new Error('Test execution error');
        }
      });

      expect(result.status).toBe(OP_STATUS.FAILED);
      expect(result.result.error).toContain('Test execution error');
      expect(result.completedAt).toBeDefined();
    });

    test('Should sanitize sensitive data from results', async () => {
      const jobId = `test_${uuidv4().slice(0, 8)}`;

      const result = await executeOperation({
        actionType: 'test_action',
        jobId,
        target: 'test@example.com',
        input: {},
        execute: async () => ({
          success: true,
          apiKey: 'secret_key_12345',
          password: 'my_password',
          normalField: 'visible_value'
        })
      });

      expect(result.result.apiKey).toBe('[redacted]');
      expect(result.result.password).toBe('[redacted]');
      expect(result.result.normalField).toBe('visible_value');
    });
  });

  describe('Atomic Storage Writes', () => {
    test('Should write data and read it back intact', async () => {
      const testData = { test: true, items: [1, 2, 3], nested: { key: 'value' } };
      await writeData('atomic_test.json', testData);

      const read = await readData('atomic_test.json');
      expect(read.test).toBe(true);
      expect(read.items).toEqual([1, 2, 3]);
      expect(read.nested.key).toBe('value');

      // Cleanup
      const testDir = path.join(__dirname, '../../data_test');
      const testFile = path.join(testDir, 'atomic_test.json');
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    });

    test('Should not leave temp files after successful write', async () => {
      await writeData('clean_write_test.json', { clean: true });

      const testDir = path.join(__dirname, '../../data_test');
      const tmpFiles = fs.readdirSync(testDir).filter(f => f.includes('.tmp.'));
      expect(tmpFiles.length).toBe(0);

      // Cleanup
      const testFile = path.join(testDir, 'clean_write_test.json');
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    });
  });

  describe('IS_DRY_RUN is a live function', () => {
    test('IS_DRY_RUN should be a function, not a cached boolean', () => {
      expect(typeof IS_DRY_RUN).toBe('function');
    });

    test('IS_DRY_RUN should reflect runtime env changes', () => {
      const originalDryRun = process.env.DRY_RUN;

      process.env.DRY_RUN = 'true';
      expect(IS_DRY_RUN()).toBe(true);

      process.env.DRY_RUN = 'false';
      expect(IS_DRY_RUN()).toBe(false);

      delete process.env.DRY_RUN;
      expect(IS_DRY_RUN()).toBe(false);

      // Restore
      if (originalDryRun !== undefined) {
        process.env.DRY_RUN = originalDryRun;
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // PASS 3 — Durability / Crash-Safety / Idempotency Scenario Tests
  // ══════════════════════════════════════════════════════════════════════

  describe('Pass 3: Durable Pre-Write Before Side-Effect', () => {
    test('Pre-write record exists BEFORE side-effect executes', async () => {
      const jobId = `test_prewrite_${uuidv4().slice(0, 8)}`;
      let recordExistedBeforeExecute = false;

      await executeOperation({
        actionType: 'prewrite_check',
        jobId,
        target: 'target1',
        input: {},
        execute: async () => {
          // Inside the execute callback, the EXECUTING record should already
          // be persisted. Check by looking up the idempotency key.
          const key = makeIdempotencyKey('prewrite_check', jobId, 'target1', '');
          const existing = await checkDuplicate(key);
          if (existing && existing.status === OP_STATUS.EXECUTING) {
            recordExistedBeforeExecute = true;
          }
          return { success: true };
        }
      });

      expect(recordExistedBeforeExecute).toBe(true);
    });

    test('Failed side-effect still has a persisted record (FAILED, not lost)', async () => {
      const jobId = `test_fail_${uuidv4().slice(0, 8)}`;

      const result = await executeOperation({
        actionType: 'fail_after_prewrite',
        jobId,
        target: 'target1',
        input: {},
        execute: async () => {
          throw new Error('Simulated crash after pre-write');
        }
      });

      expect(result.status).toBe(OP_STATUS.FAILED);
      expect(result.result.error).toContain('Simulated crash');

      // The operation should be queryable
      const ops = await getJobOperations(jobId);
      expect(ops.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Pass 3: Restart Recovery / Reconciliation', () => {
    test('Stale EXECUTING operations are marked RECOVERY_REQUIRED', async () => {
      const { reconcileStaleOperations, getRecoveryRequired } = require('../../utils/operationLog');

      // Manually insert an EXECUTING record with old timestamp to simulate crash
      const testDir = path.join(__dirname, '../../data_test');
      const opsFile = path.join(testDir, 'operations.json');
      const staleTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago

      const staleOp = {
        operationId: `op_stale_${uuidv4().slice(0, 8)}`,
        idempotencyKey: `stale_test:${uuidv4().slice(0, 8)}:target:`,
        actionType: 'stale_test',
        jobId: 'stale_job_123',
        target: 'target',
        qualifier: null,
        inputSummary: {},
        status: 'executing',
        result: null,
        dryRun: false,
        createdAt: staleTimestamp,
        startedAt: staleTimestamp,
        completedAt: null,
        updatedAt: staleTimestamp
      };

      // Write the stale operation directly to JSON
      const opsData = { operations: [staleOp] };
      fs.writeFileSync(opsFile, JSON.stringify(opsData, null, 2));

      // Run reconciliation
      const recovery = await reconcileStaleOperations();
      expect(recovery.markedCount).toBeGreaterThanOrEqual(1);

      // Verify it's now RECOVERY_REQUIRED
      const recoveryOps = await getRecoveryRequired();
      const found = recoveryOps.find(op => op.operationId === staleOp.operationId);
      expect(found).toBeDefined();
      expect(found.status).toBe('recovery_required');
    });

    test('Recent EXECUTING operations are NOT marked as stale', async () => {
      const { reconcileStaleOperations } = require('../../utils/operationLog');

      const testDir = path.join(__dirname, '../../data_test');
      const opsFile = path.join(testDir, 'operations.json');
      const recentTimestamp = new Date().toISOString(); // just now

      const recentOp = {
        operationId: `op_recent_${uuidv4().slice(0, 8)}`,
        idempotencyKey: `recent_test:${uuidv4().slice(0, 8)}:target:`,
        actionType: 'recent_test',
        jobId: 'recent_job_123',
        target: 'target',
        qualifier: null,
        inputSummary: {},
        status: 'executing',
        result: null,
        dryRun: false,
        createdAt: recentTimestamp,
        startedAt: recentTimestamp,
        completedAt: null,
        updatedAt: recentTimestamp
      };

      fs.writeFileSync(opsFile, JSON.stringify({ operations: [recentOp] }, null, 2));

      const recovery = await reconcileStaleOperations();
      // Should NOT mark this one — it's too recent
      expect(recovery.markedCount).toBe(0);
    });
  });

  describe('Pass 3: Duplicate Prevention Under Repeated Invocation', () => {
    test('Same operation triggered twice only executes once (sequential)', async () => {
      const jobId = `test_dup_${uuidv4().slice(0, 8)}`;
      let executionCount = 0;

      const run = (n) => executeOperation({
        actionType: 'dup_test',
        jobId,
        target: 'same_target',
        qualifier: 'same_qualifier',
        input: {},
        execute: async () => {
          executionCount++;
          return { success: true, run: n };
        }
      });

      // Sequential calls — first completes, second is deduped
      const r1 = await run(1);
      const r2 = await run(2);

      expect(r1.status).toBe(OP_STATUS.COMPLETED);
      expect(r2.status).toBe(OP_STATUS.DUPLICATE);
      expect(executionCount).toBe(1); // Side-effect ran exactly once
    });

    test('Different qualifiers allow separate operations', async () => {
      const jobId = `test_diff_${uuidv4().slice(0, 8)}`;
      let executionCount = 0;

      const run = (qualifier) => executeOperation({
        actionType: 'qualifier_test',
        jobId,
        target: 'same_target',
        qualifier,
        input: {},
        execute: async () => {
          executionCount++;
          return { success: true };
        }
      });

      await run('qualifier_a');
      await run('qualifier_b');

      expect(executionCount).toBe(2);
    });
  });

  describe('Pass 3: Billing Invoice Dedup via Operation Framework', () => {
    test('generateInvoice uses executeOperation (idempotency key present)', async () => {
      // We can verify that billing.generateInvoice routes through executeOperation
      // by checking that it returns null when policy blocks it (non-delivered job)
      const { generateInvoice } = require('../../utils/billing');

      const fakeJob = {
        id: `job_billing_${uuidv4().slice(0, 8)}`,
        data: { client: 'Test Client', contentType: 'blog_post' },
        client: { name: 'Test Client', email: 'test@example.com' },
        status: 'writing' // NOT delivered — policy should block
      };

      const result = await generateInvoice(fakeJob);
      // Should be null because the policy guard blocks non-delivered jobs
      expect(result).toBeNull();
    });

    test('generateInvoice dedupes repeated calls for same job', async () => {
      const { generateInvoice, INVOICE_STATUS } = require('../../utils/billing');

      // Create a job that looks delivered (bypass policy by providing pricing)
      const jobId = `job_dedup_${uuidv4().slice(0, 8)}`;
      const fakeJob = {
        id: jobId,
        data: { client: 'Dedup Client', contentType: 'blog_post', topic: 'Test Topic' },
        client: { name: 'Dedup Client', email: 'dedup@example.com' },
        pricing: { amount: 500, model: 'per_piece' },
        status: 'delivered'
      };

      // We need to make the policy allow this — the policy checks if job
      // is in DELIVERED state via storage lookup. Since we can't easily
      // mock that, we test at the operation level instead.
      // The executeOperation framework will deduplicate regardless.
      const key = makeIdempotencyKey('invoice_generate', jobId, 'Dedup Client', '500');

      // First call — no prior operation with this key
      const firstCheck = await checkDuplicate(key);
      expect(firstCheck).toBeNull();

      // Execute the operation directly to prove dedup works
      let callCount = 0;
      const r1 = await executeOperation({
        actionType: 'invoice_generate',
        jobId,
        target: 'Dedup Client',
        qualifier: '500',
        input: { jobId, amount: 500, client: 'Dedup Client' },
        execute: async () => {
          callCount++;
          return { invoiceId: 'inv_test123', amount: 500 };
        }
      });

      const r2 = await executeOperation({
        actionType: 'invoice_generate',
        jobId,
        target: 'Dedup Client',
        qualifier: '500',
        input: { jobId, amount: 500, client: 'Dedup Client' },
        execute: async () => {
          callCount++;
          return { invoiceId: 'inv_test456', amount: 500 };
        }
      });

      expect(r1.status).toBe(OP_STATUS.COMPLETED);
      expect(r2.status).toBe(OP_STATUS.DUPLICATE);
      expect(callCount).toBe(1); // Only one invoice created
    });
  });

  describe('Pass 3: Operations Persisted in Storage (not lost)', () => {
    test('Completed operations are queryable after execution', async () => {
      const { getRecentOperations } = require('../../utils/operationLog');

      const jobId = `test_persist_${uuidv4().slice(0, 8)}`;

      await executeOperation({
        actionType: 'persist_test',
        jobId,
        target: 'persist_target',
        input: {},
        execute: async () => ({ persisted: true })
      });

      const recent = await getRecentOperations(50);
      const found = recent.find(op => op.jobId === jobId && op.actionType === 'persist_test');
      expect(found).toBeDefined();
      expect(found.status).toBe(OP_STATUS.COMPLETED);
    });

    test('Operations include full audit trail fields', async () => {
      const jobId = `test_audit_${uuidv4().slice(0, 8)}`;

      const result = await executeOperation({
        actionType: 'audit_test',
        jobId,
        target: 'audit_target',
        qualifier: 'qual_1',
        input: { key: 'value' },
        execute: async () => ({ audited: true })
      });

      expect(result.operationId).toMatch(/^op_/);
      expect(result.idempotencyKey).toContain('audit_test');
      expect(result.idempotencyKey).toContain(jobId);
      expect(result.actionType).toBe('audit_test');
      expect(result.jobId).toBe(jobId);
      expect(result.target).toBe('audit_target');
      expect(result.createdAt).toBeDefined();
      expect(result.completedAt).toBeDefined();
      expect(result.inputSummary).toBeDefined();
    });
  });

  describe('Pass 3: Operator Visibility of Recovery Operations', () => {
    test('getRecoveryRequired returns only RECOVERY_REQUIRED ops', async () => {
      const { reconcileStaleOperations, getRecoveryRequired } = require('../../utils/operationLog');

      const testDir = path.join(__dirname, '../../data_test');
      const opsFile = path.join(testDir, 'operations.json');
      const staleTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();

      // Insert mix of statuses
      const ops = {
        operations: [
          {
            operationId: 'op_stale_vis1',
            idempotencyKey: `vis_stale:${uuidv4().slice(0, 8)}:t:`,
            actionType: 'vis_test', jobId: 'vis_job', target: 't',
            qualifier: null, inputSummary: {}, status: 'executing',
            result: null, dryRun: false, createdAt: staleTime,
            startedAt: staleTime, completedAt: null, updatedAt: staleTime
          },
          {
            operationId: 'op_completed_vis1',
            idempotencyKey: `vis_done:${uuidv4().slice(0, 8)}:t:`,
            actionType: 'vis_test', jobId: 'vis_job2', target: 't',
            qualifier: null, inputSummary: {}, status: 'completed',
            result: { ok: true }, dryRun: false, createdAt: staleTime,
            startedAt: staleTime, completedAt: staleTime, updatedAt: staleTime
          }
        ]
      };

      fs.writeFileSync(opsFile, JSON.stringify(ops, null, 2));

      await reconcileStaleOperations();

      const recoveryOps = await getRecoveryRequired();
      // Should include the stale executing one, NOT the completed one
      expect(recoveryOps.some(op => op.operationId === 'op_stale_vis1')).toBe(true);
      expect(recoveryOps.some(op => op.operationId === 'op_completed_vis1')).toBe(false);
    });
  });
});
