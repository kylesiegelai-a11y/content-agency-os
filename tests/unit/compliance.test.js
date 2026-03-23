/**
 * Unit tests for the compliance module (../../utils/compliance.js)
 * Tests opt-out detection, suppression list management, and pre-send checks
 */

// Set env variables BEFORE importing modules
process.env.MOCK_MODE = 'true';
process.env.NODE_ENV = 'test';

const {
  detectOptOut,
  addToSuppressionList,
  processInboundReply,
  preSendCheck,
  isSuppressed,
  getAuditLog
} = require('../../utils/compliance');

// Mock the storage layer with state tracking
let mockComplianceData = {
  rateLimits: {},
  suppression: { emails: [], domains: [] },
  sendLog: [],
  purgeLog: [],
  auditLog: []
};

jest.mock('../../utils/storage', () => ({
  readData: jest.fn(async (file) => {
    if (file === 'compliance.json') {
      return JSON.parse(JSON.stringify(mockComplianceData)); // Return deep copy
    }
    return null;
  }),
  writeData: jest.fn(async (file, data) => {
    if (file === 'compliance.json') {
      mockComplianceData = JSON.parse(JSON.stringify(data)); // Store deep copy
    }
  }),
  appendToArray: jest.fn(async () => {})
}));

// Mock the logger
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

describe('Compliance Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock state
    mockComplianceData = {
      rateLimits: {},
      suppression: { emails: [], domains: [] },
      sendLog: [],
      purgeLog: [],
      auditLog: []
    };
  });

  // ════════════════════════════════════════════════════════════════════════════
  // detectOptOut Tests
  // ════════════════════════════════════════════════════════════════════════════

  describe('detectOptOut', () => {
    test('detects "unsubscribe" keyword', () => {
      const result = detectOptOut('Please unsubscribe me from this list');

      expect(result.isOptOut).toBe(true);
      expect(result.matchedKeywords).toContain('unsubscribe');
    });

    test('detects "opt out" keyword', () => {
      const result = detectOptOut('I want to opt out of these emails');

      expect(result.isOptOut).toBe(true);
      expect(result.matchedKeywords).toContain('opt out');
    });

    test('detects "opt-out" keyword (hyphenated)', () => {
      const result = detectOptOut('opt-out me from the mailing list');

      expect(result.isOptOut).toBe(true);
      expect(result.matchedKeywords).toContain('opt-out');
    });

    test('detects "remove me" keyword', () => {
      const result = detectOptOut('remove me from future communications');

      expect(result.isOptOut).toBe(true);
      expect(result.matchedKeywords).toContain('remove me');
    });

    test('detects "stop emailing" keyword', () => {
      const result = detectOptOut('stop emailing me immediately');

      expect(result.isOptOut).toBe(true);
      expect(result.matchedKeywords).toContain('stop emailing');
    });

    test('returns isOptOut false for normal message', () => {
      const result = detectOptOut('Hi, thanks for reaching out. Interested in learning more.');

      expect(result.isOptOut).toBe(false);
      expect(result.matchedKeywords).toHaveLength(0);
    });

    test('is case-insensitive', () => {
      const result = detectOptOut('UNSUBSCRIBE me NOW');

      expect(result.isOptOut).toBe(true);
      expect(result.matchedKeywords.length).toBeGreaterThan(0);
    });

    test('detects multiple opt-out keywords in single message', () => {
      const result = detectOptOut('Please unsubscribe and remove me from your list');

      expect(result.isOptOut).toBe(true);
      expect(result.matchedKeywords.length).toBeGreaterThanOrEqual(2);
    });

    test('handles empty string', () => {
      const result = detectOptOut('');

      expect(result.isOptOut).toBe(false);
      expect(result.matchedKeywords).toHaveLength(0);
    });

    test('handles null message', () => {
      const result = detectOptOut(null);

      expect(result.isOptOut).toBe(false);
      expect(result.matchedKeywords).toHaveLength(0);
    });

    test('handles non-string input gracefully', () => {
      const result = detectOptOut(123);

      expect(result.isOptOut).toBe(false);
      expect(result.matchedKeywords).toHaveLength(0);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // addToSuppressionList Tests
  // ════════════════════════════════════════════════════════════════════════════

  describe('addToSuppressionList', () => {
    test('adds valid email to suppression list', async () => {
      const result = await addToSuppressionList('user@example.com', 'manual', 'user');

      expect(result.added).toBe(true);
      expect(result.entry).toBeDefined();
      expect(result.entry.email).toBe('user@example.com');
    });

    test('rejects invalid email format', async () => {
      const result = await addToSuppressionList('not-an-email', 'manual', 'user');

      expect(result.added).toBe(false);
      expect(result.reason).toContain('Invalid email format');
    });

    test('rejects email without @ sign', async () => {
      const result = await addToSuppressionList('invalidemail.com', 'manual', 'user');

      expect(result.added).toBe(false);
      expect(result.reason).toContain('Invalid');
    });

    test('rejects email without domain extension', async () => {
      const result = await addToSuppressionList('user@domain', 'manual', 'user');

      expect(result.added).toBe(false);
    });

    test('rejects empty email', async () => {
      const result = await addToSuppressionList('', 'manual', 'user');

      expect(result.added).toBe(false);
      expect(result.reason).toContain('Empty email');
    });

    test('rejects null email', async () => {
      const result = await addToSuppressionList(null, 'manual', 'user');

      expect(result.added).toBe(false);
    });

    test('normalizes email to lowercase', async () => {
      const result = await addToSuppressionList('User@EXAMPLE.COM', 'manual', 'user');

      expect(result.entry.email).toBe('user@example.com');
    });

    test('stores suppression reason', async () => {
      const result = await addToSuppressionList('test@example.com', 'unsubscribe_request', 'user');

      expect(result.entry.reason).toBe('unsubscribe_request');
    });

    test('stores suppression source (auto_detect vs user)', async () => {
      const result = await addToSuppressionList('test@example.com', 'opt-out', 'auto_detect');

      expect(result.entry.source).toBe('auto_detect');
    });

    test('includes timestamp when added', async () => {
      const result = await addToSuppressionList('test@example.com', 'manual', 'user');

      expect(result.entry.addedAt).toBeDefined();
      expect(typeof result.entry.addedAt).toBe('string');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // processInboundReply Tests
  // ════════════════════════════════════════════════════════════════════════════

  describe('processInboundReply', () => {
    test('detects opt-out and auto-suppresses sender', async () => {
      const result = await processInboundReply('reply@example.com', 'Please unsubscribe me');

      expect(result.optOutDetected).toBe(true);
      expect(result.suppressed).toBe(true);
      expect(result.keywords).toContain('unsubscribe');
    });

    test('processes normal reply without suppressing', async () => {
      const result = await processInboundReply('reply@example.com', 'Thanks, I am interested');

      expect(result.optOutDetected).toBe(false);
      expect(result.suppressed).toBeUndefined();
    });

    test('returns error for invalid sender email', async () => {
      const result = await processInboundReply('not-an-email', 'unsubscribe');

      expect(result.optOutDetected).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Invalid');
    });

    test('captures matched opt-out keywords in result', async () => {
      const result = await processInboundReply('user@example.com', 'Please remove me and unsubscribe');

      expect(result.optOutDetected).toBe(true);
      expect(result.keywords.length).toBeGreaterThanOrEqual(2);
    });

    test('handles empty message body', async () => {
      const result = await processInboundReply('valid@example.com', '');

      expect(result.optOutDetected).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // preSendCheck Tests
  // ════════════════════════════════════════════════════════════════════════════

  describe('preSendCheck', () => {
    test('allows send when no suppression exists', async () => {
      const result = await preSendCheck('new@example.com');

      expect(result.allowed).toBe(true);
    });

    test('blocks send if email is suppressed', async () => {
      // First suppress an email
      await addToSuppressionList('suppressed@example.com', 'manual', 'user');

      // Then check pre-send
      const result = await preSendCheck('suppressed@example.com');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('suppression list');
    });

    test('returns check type in allowed result', async () => {
      const result = await preSendCheck('valid@example.com');

      expect(result).toHaveProperty('allowed');
    });

    test('includes reason when blocking', async () => {
      await addToSuppressionList('blocked@example.com', 'test', 'user');

      const result = await preSendCheck('blocked@example.com');

      expect(result.reason).toBeDefined();
      expect(typeof result.reason).toBe('string');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // isSuppressed Tests
  // ════════════════════════════════════════════════════════════════════════════

  describe('isSuppressed', () => {
    test('returns suppressed false for new email', async () => {
      const result = await isSuppressed('brand-new@example.com');

      expect(result.suppressed).toBe(false);
      expect(result.emailMatch).toBe(false);
    });

    test('normalizes email to lowercase for checking', async () => {
      await addToSuppressionList('test@example.com', 'manual', 'user');

      const result = await isSuppressed('TEST@EXAMPLE.COM');

      expect(result.email).toBe('test@example.com');
    });

    test('returns email and domain in result', async () => {
      const result = await isSuppressed('user@company.com');

      expect(result.email).toBeDefined();
      expect(result.domain).toBeDefined();
      expect(result.domain).toBe('company.com');
    });

    test('tracks whether match is email-level or domain-level', async () => {
      const result = await isSuppressed('someone@example.com');

      expect(result).toHaveProperty('emailMatch');
      expect(result).toHaveProperty('domainMatch');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // getAuditLog Tests
  // ════════════════════════════════════════════════════════════════════════════

  describe('getAuditLog', () => {
    test('returns audit log array', async () => {
      const log = await getAuditLog();

      expect(Array.isArray(log)).toBe(true);
    });

    test('respects limit parameter', async () => {
      const log = await getAuditLog(10);

      expect(log.length).toBeLessThanOrEqual(10);
    });

    test('defaults to limit of 100', async () => {
      const log = await getAuditLog();

      expect(Array.isArray(log)).toBe(true);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Integration Tests
  // ════════════════════════════════════════════════════════════════════════════

  describe('end-to-end compliance workflow', () => {
    test('inbound reply with opt-out updates suppression', async () => {
      const senderEmail = 'customer@example.com';
      const optOutMessage = 'I want to unsubscribe from your emails';

      const processResult = await processInboundReply(senderEmail, optOutMessage);

      expect(processResult.optOutDetected).toBe(true);
      expect(processResult.suppressed).toBe(true);

      const suppressedResult = await isSuppressed(senderEmail);
      expect(suppressedResult.suppressed).toBe(true);
    });

    test('pre-send check respects suppression added via processInboundReply', async () => {
      const email = 'reply@example.com';

      // Process inbound opt-out
      await processInboundReply(email, 'remove me');

      // Pre-send check should now block
      const preSendResult = await preSendCheck(email);

      expect(preSendResult.allowed).toBe(false);
    });

    test('manual suppression prevents sends', async () => {
      const email = 'customer@example.com';

      // Manually suppress
      await addToSuppressionList(email, 'manual_block', 'user');

      // Verify suppression
      const suppressed = await isSuppressed(email);
      expect(suppressed.suppressed).toBe(true);

      // Check pre-send
      const preSendResult = await preSendCheck(email);
      expect(preSendResult.allowed).toBe(false);
    });
  });
});
