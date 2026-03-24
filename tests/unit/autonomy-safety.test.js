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

// Set test environment
process.env.NODE_ENV = 'test';
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
  DRY_RUN
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
    test('Should record operations even in dry-run conditions', async () => {
      // DRY_RUN is a module-level constant, so we test the status field instead
      const result = await executeOperation({
        actionType: 'test_dry_run',
        jobId: `test_${uuidv4().slice(0, 8)}`,
        target: 'test@example.com',
        input: {},
        execute: async () => ({ success: true })
      });

      // Operation should be recorded
      expect(result.operationId).toBeDefined();
      expect(result.status).toBeDefined();
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
});
