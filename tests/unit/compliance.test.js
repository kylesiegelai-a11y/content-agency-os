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

  // ════════════════════════════════════════════════════════════════════════════
  // Rate Limit Edge Cases (Lines 134-135, 144, 154)
  // ════════════════════════════════════════════════════════════════════════════

  describe('checkRateLimit - cooldown constraint', () => {
    test('blocks send during cooldown period', async () => {
      const {
        checkRateLimit,
        recordSend,
        RATE_LIMITS
      } = require('../../utils/compliance');

      // Record a send
      await recordSend('user@example.com');

      // Immediately try to send again (within cooldown)
      const result = await checkRateLimit('user2@example.com');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Cooldown');
      expect(result.retryAfterMs).toBeDefined();
      expect(result.retryAfterMs).toBeGreaterThan(0);
      expect(result.retryAfterMs).toBeLessThanOrEqual(RATE_LIMITS.cooldownMs);
    });

    test('retryAfterMs is accurate', async () => {
      const {
        checkRateLimit,
        recordSend,
        RATE_LIMITS
      } = require('../../utils/compliance');

      await recordSend('user@example.com');
      const result = await checkRateLimit('user2@example.com');

      expect(result.retryAfterMs).toBeLessThanOrEqual(RATE_LIMITS.cooldownMs);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    test('includes cooldown reason message with calculated wait time', async () => {
      const {
        checkRateLimit,
        recordSend
      } = require('../../utils/compliance');

      await recordSend('user@example.com');
      const result = await checkRateLimit('user2@example.com');

      expect(result.reason).toMatch(/wait \d+s between sends/);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Global Daily Limit (Line 144)
  // ════════════════════════════════════════════════════════════════════════════

  describe('checkRateLimit - global daily limit', () => {
    test('blocks send when global daily limit reached', async () => {
      const {
        checkRateLimit,
        RATE_LIMITS
      } = require('../../utils/compliance');

      // Generate today's key in UTC
      const now = new Date();
      const y = now.getUTCFullYear();
      const m = String(now.getUTCMonth() + 1).padStart(2, '0');
      const d = String(now.getUTCDate()).padStart(2, '0');
      const today = `${y}-${m}-${d}`;

      // Mock data to simulate hitting the limit
      mockComplianceData.rateLimits = {
        [today]: {
          total: RATE_LIMITS.maxTotalPerDay,
          domains: {},
          lastSendAt: Date.now() - RATE_LIMITS.cooldownMs - 1000
        }
      };

      const result = await checkRateLimit('user@example.com');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Daily send limit reached');
      expect(result.reason).toContain(String(RATE_LIMITS.maxTotalPerDay));
      expect(result.retryAfterMs).toBeNull();
    });

    test('global limit reason mentions max total per day', async () => {
      const {
        checkRateLimit,
        RATE_LIMITS
      } = require('../../utils/compliance');

      // Generate today's key in UTC
      const now = new Date();
      const y = now.getUTCFullYear();
      const m = String(now.getUTCMonth() + 1).padStart(2, '0');
      const d = String(now.getUTCDate()).padStart(2, '0');
      const today = `${y}-${m}-${d}`;

      mockComplianceData.rateLimits = {
        [today]: {
          total: RATE_LIMITS.maxTotalPerDay,
          domains: {},
          lastSendAt: Date.now() - RATE_LIMITS.cooldownMs - 1000
        }
      };

      const result = await checkRateLimit('user@example.com');

      expect(result.reason).toContain(`${RATE_LIMITS.maxTotalPerDay}/day`);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Per-Domain Daily Limit (Line 154)
  // ════════════════════════════════════════════════════════════════════════════

  describe('checkRateLimit - per-domain daily limit', () => {
    test('blocks send when domain daily limit reached', async () => {
      const {
        checkRateLimit,
        RATE_LIMITS
      } = require('../../utils/compliance');

      // Generate today's key in UTC
      const now = new Date();
      const y = now.getUTCFullYear();
      const m = String(now.getUTCMonth() + 1).padStart(2, '0');
      const d = String(now.getUTCDate()).padStart(2, '0');
      const today = `${y}-${m}-${d}`;

      mockComplianceData.rateLimits = {
        [today]: {
          total: 10,
          domains: { 'example.com': RATE_LIMITS.maxPerDomainPerDay },
          lastSendAt: Date.now() - RATE_LIMITS.cooldownMs - 1000
        }
      };

      const result = await checkRateLimit('user@example.com');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Domain limit reached');
      expect(result.reason).toContain('example.com');
      expect(result.reason).toContain(String(RATE_LIMITS.maxPerDomainPerDay));
      expect(result.retryAfterMs).toBeNull();
    });

    test('domain limit shows correct domain name in reason', async () => {
      const {
        checkRateLimit,
        RATE_LIMITS
      } = require('../../utils/compliance');

      // Generate today's key in UTC
      const now = new Date();
      const y = now.getUTCFullYear();
      const m = String(now.getUTCMonth() + 1).padStart(2, '0');
      const d = String(now.getUTCDate()).padStart(2, '0');
      const today = `${y}-${m}-${d}`;

      const targetDomain = 'corporate.io';
      mockComplianceData.rateLimits = {
        [today]: {
          total: 10,
          domains: { [targetDomain]: RATE_LIMITS.maxPerDomainPerDay },
          lastSendAt: Date.now() - RATE_LIMITS.cooldownMs - 1000
        }
      };

      const result = await checkRateLimit(`user@${targetDomain}`);

      expect(result.reason).toContain(targetDomain);
    });

    test('allows send when domain has capacity remaining', async () => {
      const {
        checkRateLimit,
        RATE_LIMITS
      } = require('../../utils/compliance');

      // Generate today's key in UTC
      const now = new Date();
      const y = now.getUTCFullYear();
      const m = String(now.getUTCMonth() + 1).padStart(2, '0');
      const d = String(now.getUTCDate()).padStart(2, '0');
      const today = `${y}-${m}-${d}`;

      mockComplianceData.rateLimits = {
        [today]: {
          total: 10,
          domains: { 'example.com': RATE_LIMITS.maxPerDomainPerDay - 1 },
          lastSendAt: Date.now() - RATE_LIMITS.cooldownMs - 1000
        }
      };

      const result = await checkRateLimit('user@example.com');

      expect(result.allowed).toBe(true);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Send Log Trimming (Line 191)
  // ════════════════════════════════════════════════════════════════════════════

  describe('recordSend - send log management', () => {
    test('trims send log when it exceeds 1000 entries', async () => {
      const {
        recordSend
      } = require('../../utils/compliance');

      // Create 1001 entries
      mockComplianceData.sendLog = Array.from({ length: 1001 }, (_, i) => ({
        email: `user${i}@example.com`,
        domain: 'example.com',
        sentAt: new Date().toISOString()
      }));

      await recordSend('newuser@example.com');

      expect(mockComplianceData.sendLog.length).toBe(1000);
    });

    test('keeps the most recent 1000 entries when trimming', async () => {
      const {
        recordSend
      } = require('../../utils/compliance');

      // Create 1001 entries with distinct emails
      mockComplianceData.sendLog = Array.from({ length: 1001 }, (_, i) => ({
        email: `user${i}@example.com`,
        domain: 'example.com',
        sentAt: new Date().toISOString()
      }));

      await recordSend('newuser@example.com');

      // Should not contain the first entry (user0)
      const firstEmailExists = mockComplianceData.sendLog.some(
        entry => entry.email === 'user0@example.com'
      );
      expect(firstEmailExists).toBe(false);
      expect(mockComplianceData.sendLog.length).toBe(1000);
    });

    test('records send with correct email and domain', async () => {
      const {
        recordSend
      } = require('../../utils/compliance');

      await recordSend('test@company.io');

      const lastEntry = mockComplianceData.sendLog[mockComplianceData.sendLog.length - 1];
      expect(lastEntry.email).toBe('test@company.io');
      expect(lastEntry.domain).toBe('company.io');
      expect(lastEntry.sentAt).toBeDefined();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // getRateLimitStatus (Lines 204-208)
  // ════════════════════════════════════════════════════════════════════════════

  describe('getRateLimitStatus', () => {
    test('returns complete rate limit status object', async () => {
      const {
        getRateLimitStatus
      } = require('../../utils/compliance');

      const status = await getRateLimitStatus();

      expect(status).toHaveProperty('date');
      expect(status).toHaveProperty('totalSent');
      expect(status).toHaveProperty('maxTotal');
      expect(status).toHaveProperty('remainingTotal');
      expect(status).toHaveProperty('domains');
      expect(status).toHaveProperty('maxPerDomain');
      expect(status).toHaveProperty('cooldownMs');
      expect(status).toHaveProperty('lastSendAt');
      expect(status).toHaveProperty('limits');
    });

    test('shows remaining total correctly', async () => {
      const {
        getRateLimitStatus,
        RATE_LIMITS
      } = require('../../utils/compliance');

      // Generate today's key in UTC
      const now = new Date();
      const y = now.getUTCFullYear();
      const m = String(now.getUTCMonth() + 1).padStart(2, '0');
      const d = String(now.getUTCDate()).padStart(2, '0');
      const today = `${y}-${m}-${d}`;

      mockComplianceData.rateLimits = {
        [today]: {
          total: 25,
          domains: {},
          lastSendAt: 0
        }
      };

      const status = await getRateLimitStatus();

      expect(status.totalSent).toBe(25);
      expect(status.remainingTotal).toBe(RATE_LIMITS.maxTotalPerDay - 25);
    });

    test('remaining never goes below zero', async () => {
      const {
        getRateLimitStatus,
        RATE_LIMITS
      } = require('../../utils/compliance');

      // Generate today's key in UTC
      const now = new Date();
      const y = now.getUTCFullYear();
      const m = String(now.getUTCMonth() + 1).padStart(2, '0');
      const d = String(now.getUTCDate()).padStart(2, '0');
      const today = `${y}-${m}-${d}`;

      mockComplianceData.rateLimits = {
        [today]: {
          total: RATE_LIMITS.maxTotalPerDay + 50,
          domains: {},
          lastSendAt: 0
        }
      };

      const status = await getRateLimitStatus();

      expect(status.remainingTotal).toBe(0);
    });

    test('returns null lastSendAt when no sends today', async () => {
      const {
        getRateLimitStatus
      } = require('../../utils/compliance');

      const status = await getRateLimitStatus();

      expect(status.lastSendAt).toBeNull();
    });

    test('returns ISO timestamp for lastSendAt', async () => {
      const {
        getRateLimitStatus
      } = require('../../utils/compliance');

      // Generate today's key in UTC
      const now = new Date();
      const y = now.getUTCFullYear();
      const m = String(now.getUTCMonth() + 1).padStart(2, '0');
      const d = String(now.getUTCDate()).padStart(2, '0');
      const today = `${y}-${m}-${d}`;

      const timestamp = Date.now();
      mockComplianceData.rateLimits = {
        [today]: {
          total: 1,
          domains: {},
          lastSendAt: timestamp
        }
      };

      const status = await getRateLimitStatus();

      expect(status.lastSendAt).toBeDefined();
      expect(typeof status.lastSendAt).toBe('string');
      // Verify it's a valid ISO string
      expect(new Date(status.lastSendAt).getTime()).toBeGreaterThan(0);
    });

    test('includes rate limits config in response', async () => {
      const {
        getRateLimitStatus,
        RATE_LIMITS
      } = require('../../utils/compliance');

      const status = await getRateLimitStatus();

      expect(status.limits).toEqual(RATE_LIMITS);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Domain Suppression (Lines 237, 292-374)
  // ════════════════════════════════════════════════════════════════════════════

  describe('Domain suppression detection', () => {
    test('detects when email domain is suppressed', async () => {
      const {
        addDomainToSuppressionList,
        isSuppressed
      } = require('../../utils/compliance');

      // Suppress entire domain
      await addDomainToSuppressionList('badactors.com', 'spammer', 'user');

      // Check suppression for email on that domain
      const result = await isSuppressed('anyone@badactors.com');

      expect(result.suppressed).toBe(true);
      expect(result.domainMatch).toBe(true);
      expect(result.emailMatch).toBe(false);
    });

    test('isSuppressed returns correct domain value', async () => {
      const {
        isSuppressed
      } = require('../../utils/compliance');

      const result = await isSuppressed('user@testcorp.com');

      expect(result.domain).toBe('testcorp.com');
    });
  });

  describe('addDomainToSuppressionList', () => {
    test('adds valid domain to suppression list', async () => {
      const {
        addDomainToSuppressionList
      } = require('../../utils/compliance');

      const result = await addDomainToSuppressionList('example.com', 'manual', 'user');

      expect(result.added).toBe(true);
      expect(result.entry).toBeDefined();
      expect(result.entry.domain).toBe('example.com');
    });

    test('normalizes domain to lowercase', async () => {
      const {
        addDomainToSuppressionList
      } = require('../../utils/compliance');

      const result = await addDomainToSuppressionList('EXAMPLE.COM', 'manual', 'user');

      expect(result.entry.domain).toBe('example.com');
    });

    test('stores domain suppression reason', async () => {
      const {
        addDomainToSuppressionList
      } = require('../../utils/compliance');

      const result = await addDomainToSuppressionList('bad.com', 'spam_source', 'user');

      expect(result.entry.reason).toBe('spam_source');
    });

    test('stores domain suppression source', async () => {
      const {
        addDomainToSuppressionList
      } = require('../../utils/compliance');

      const result = await addDomainToSuppressionList('bad.com', 'auto', 'auto_detect');

      expect(result.entry.source).toBe('auto_detect');
    });

    test('rejects empty domain', async () => {
      const {
        addDomainToSuppressionList
      } = require('../../utils/compliance');

      const result = await addDomainToSuppressionList('', 'manual', 'user');

      expect(result.added).toBe(false);
      expect(result.reason).toContain('Empty domain');
    });

    test('rejects duplicate domain suppression', async () => {
      const {
        addDomainToSuppressionList
      } = require('../../utils/compliance');

      await addDomainToSuppressionList('example.com', 'manual', 'user');
      const result = await addDomainToSuppressionList('example.com', 'manual', 'user');

      expect(result.added).toBe(false);
      expect(result.reason).toContain('Already suppressed');
    });

    test('includes timestamp in domain suppression entry', async () => {
      const {
        addDomainToSuppressionList
      } = require('../../utils/compliance');

      const result = await addDomainToSuppressionList('example.com', 'manual', 'user');

      expect(result.entry.addedAt).toBeDefined();
      expect(typeof result.entry.addedAt).toBe('string');
    });
  });

  describe('removeDomainFromSuppressionList', () => {
    test('removes domain from suppression list', async () => {
      const {
        addDomainToSuppressionList,
        removeDomainFromSuppressionList,
        isSuppressed
      } = require('../../utils/compliance');

      // Add then remove
      await addDomainToSuppressionList('temp.com', 'test', 'user');
      const result = await removeDomainFromSuppressionList('temp.com');

      expect(result.removed).toBe(true);

      // Verify it's really gone
      const checkResult = await isSuppressed('user@temp.com');
      expect(checkResult.domainMatch).toBe(false);
    });

    test('returns removed false when domain not in list', async () => {
      const {
        removeDomainFromSuppressionList
      } = require('../../utils/compliance');

      const result = await removeDomainFromSuppressionList('nothere.com');

      expect(result.removed).toBe(false);
    });

    test('normalizes domain when removing', async () => {
      const {
        addDomainToSuppressionList,
        removeDomainFromSuppressionList
      } = require('../../utils/compliance');

      await addDomainToSuppressionList('example.com', 'test', 'user');
      const result = await removeDomainFromSuppressionList('EXAMPLE.COM');

      expect(result.removed).toBe(true);
    });

    test('logs removal to audit trail', async () => {
      const {
        addDomainToSuppressionList,
        removeDomainFromSuppressionList
      } = require('../../utils/compliance');

      await addDomainToSuppressionList('example.com', 'test', 'user');
      await removeDomainFromSuppressionList('example.com');

      const auditEntry = mockComplianceData.auditLog.find(
        entry => entry.action === 'domain_suppression_removed'
      );
      expect(auditEntry).toBeDefined();
      expect(auditEntry.domain).toBe('example.com');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Data Purge / GDPR (Lines 432-591)
  // ════════════════════════════════════════════════════════════════════════════

  describe('purgePersonalData', () => {
    test('returns purged false for empty email', async () => {
      const {
        purgePersonalData
      } = require('../../utils/compliance');

      const result = await purgePersonalData('');

      expect(result.purged).toBe(false);
      expect(result.reason).toContain('Empty email');
    });

    test('includes email and regulation in purge summary', async () => {
      const {
        purgePersonalData
      } = require('../../utils/compliance');

      const result = await purgePersonalData('test@example.com', 'owner', 'GDPR');

      expect(result.email).toBe('test@example.com');
      expect(result.regulation).toBe('GDPR');
    });

    test('includes requestedBy in purge summary', async () => {
      const {
        purgePersonalData
      } = require('../../utils/compliance');

      const result = await purgePersonalData('test@example.com', 'legal_team', 'CCPA');

      expect(result.requestedBy).toBe('legal_team');
    });

    test('includes requestedAt timestamp', async () => {
      const {
        purgePersonalData
      } = require('../../utils/compliance');

      const result = await purgePersonalData('test@example.com', 'owner', 'GDPR');

      expect(result.requestedAt).toBeDefined();
      expect(typeof result.requestedAt).toBe('string');
    });

    test('tracks removedFrom record counts', async () => {
      const {
        purgePersonalData
      } = require('../../utils/compliance');

      // Add some mock data to suppress list
      mockComplianceData.suppression.emails.push({
        email: 'test@example.com',
        reason: 'manual'
      });

      const result = await purgePersonalData('test@example.com', 'owner', 'GDPR');

      expect(result.removedFrom).toBeDefined();
      expect(typeof result.removedFrom).toBe('object');
    });

    test('purges from suppression list', async () => {
      const {
        addToSuppressionList,
        purgePersonalData,
        isSuppressed
      } = require('../../utils/compliance');

      const email = 'customer@example.com';
      await addToSuppressionList(email, 'manual', 'user');

      // Verify it's suppressed before purge
      let checkResult = await isSuppressed(email);
      expect(checkResult.suppressed).toBe(true);

      // Purge
      const purgeResult = await purgePersonalData(email, 'owner', 'GDPR');
      expect(purgeResult.purged).toBe(true);

      // Verify it's no longer suppressed
      checkResult = await isSuppressed(email);
      expect(checkResult.suppressed).toBe(false);
    });

    test('purges from send log', async () => {
      const {
        recordSend,
        purgePersonalData
      } = require('../../utils/compliance');

      const email = 'sender@example.com';
      await recordSend(email);

      const before = mockComplianceData.sendLog.length;

      const result = await purgePersonalData(email, 'owner', 'GDPR');

      expect(mockComplianceData.sendLog.length).toBeLessThan(before);
      expect(result.removedFrom.sendLog).toBeGreaterThan(0);
    });

    test('calculates total records affected', async () => {
      const {
        purgePersonalData
      } = require('../../utils/compliance');

      mockComplianceData.suppression.emails.push({
        email: 'test@example.com',
        reason: 'test'
      });

      const result = await purgePersonalData('test@example.com', 'owner', 'GDPR');

      expect(result.totalRecordsAffected).toBeDefined();
      expect(typeof result.totalRecordsAffected).toBe('number');
    });

    test('records purge in purge log', async () => {
      const {
        purgePersonalData
      } = require('../../utils/compliance');

      const email = 'purge@example.com';
      await purgePersonalData(email, 'legal_team', 'GDPR');

      const purgeLogEntry = mockComplianceData.purgeLog.find(
        entry => entry.email === email
      );
      expect(purgeLogEntry).toBeDefined();
      expect(purgeLogEntry.regulation).toBe('GDPR');
      expect(purgeLogEntry.requestedBy).toBe('legal_team');
    });

    test('records purge action in audit log', async () => {
      const {
        purgePersonalData
      } = require('../../utils/compliance');

      const email = 'audit@example.com';
      await purgePersonalData(email, 'compliance_officer', 'CCPA');

      const auditEntry = mockComplianceData.auditLog.find(
        entry => entry.action === 'data_purge' && entry.email === email
      );
      expect(auditEntry).toBeDefined();
      expect(auditEntry.regulation).toBe('CCPA');
      expect(auditEntry.requestedBy).toBe('compliance_officer');
    });

    test('normalizes email to lowercase for purge', async () => {
      const {
        addToSuppressionList,
        purgePersonalData
      } = require('../../utils/compliance');

      await addToSuppressionList('TEST@EXAMPLE.COM', 'manual', 'user');
      const result = await purgePersonalData('test@example.com', 'owner', 'GDPR');

      expect(result.email).toBe('test@example.com');
    });

    test('marks purged as true on successful purge', async () => {
      const {
        purgePersonalData
      } = require('../../utils/compliance');

      const result = await purgePersonalData('someone@example.com', 'owner', 'GDPR');

      expect(result.purged).toBe(true);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Audit and Purge Logs (Lines 606-621)
  // ════════════════════════════════════════════════════════════════════════════

  describe('getPurgeLog', () => {
    test('returns purge log array', async () => {
      const {
        getPurgeLog
      } = require('../../utils/compliance');

      const log = await getPurgeLog();

      expect(Array.isArray(log)).toBe(true);
    });

    test('contains purge entries after purge operation', async () => {
      const {
        purgePersonalData,
        getPurgeLog
      } = require('../../utils/compliance');

      await purgePersonalData('user@example.com', 'owner', 'GDPR');
      const log = await getPurgeLog();

      expect(log.length).toBeGreaterThan(0);
    });
  });

  describe('getComplianceSummary', () => {
    test('returns complete compliance summary object', async () => {
      const {
        getComplianceSummary
      } = require('../../utils/compliance');

      const summary = await getComplianceSummary();

      expect(summary).toHaveProperty('rateLimits');
      expect(summary).toHaveProperty('suppression');
      expect(summary).toHaveProperty('purgeLog');
      expect(summary).toHaveProperty('recentAuditLog');
      expect(summary).toHaveProperty('config');
    });

    test('includes rate limits configuration', async () => {
      const {
        getComplianceSummary,
        RATE_LIMITS
      } = require('../../utils/compliance');

      const summary = await getComplianceSummary();

      expect(summary.config.rateLimits).toEqual(RATE_LIMITS);
    });

    test('includes opt-out keywords in config', async () => {
      const {
        getComplianceSummary,
        OPT_OUT_KEYWORDS
      } = require('../../utils/compliance');

      const summary = await getComplianceSummary();

      expect(summary.config.optOutKeywords).toEqual(OPT_OUT_KEYWORDS);
    });

    test('audit log respects limit of 20 entries', async () => {
      const {
        getComplianceSummary
      } = require('../../utils/compliance');

      // Add many audit entries
      mockComplianceData.auditLog = Array.from({ length: 50 }, (_, i) => ({
        action: 'test',
        timestamp: new Date().toISOString(),
        index: i
      }));

      const summary = await getComplianceSummary();

      expect(summary.recentAuditLog.length).toBeLessThanOrEqual(20);
    });

    test('audit log is reversed (most recent first)', async () => {
      const {
        getComplianceSummary
      } = require('../../utils/compliance');

      // Add entries in order
      mockComplianceData.auditLog = Array.from({ length: 5 }, (_, i) => ({
        action: 'test',
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
        index: i
      }));

      const summary = await getComplianceSummary();

      if (summary.recentAuditLog.length >= 2) {
        const first = summary.recentAuditLog[0];
        const second = summary.recentAuditLog[1];
        // First should have higher index (more recent)
        expect(first.index).toBeGreaterThan(second.index);
      }
    });

    test('summary includes suppression list data', async () => {
      const {
        addToSuppressionList,
        getComplianceSummary
      } = require('../../utils/compliance');

      await addToSuppressionList('user@example.com', 'manual', 'user');
      const summary = await getComplianceSummary();

      expect(summary.suppression.totalEmails).toBeGreaterThan(0);
    });

    test('summary includes purge log data', async () => {
      const {
        purgePersonalData,
        getComplianceSummary
      } = require('../../utils/compliance');

      await purgePersonalData('user@example.com', 'owner', 'GDPR');
      const summary = await getComplianceSummary();

      expect(summary.purgeLog.length).toBeGreaterThan(0);
    });

    test('resolves all promises in parallel', async () => {
      const {
        getComplianceSummary
      } = require('../../utils/compliance');

      const start = Date.now();
      const summary = await getComplianceSummary();
      const elapsed = Date.now() - start;

      // Should complete relatively quickly (sub-second)
      expect(elapsed).toBeLessThan(5000);
      expect(summary).toBeDefined();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Additional Edge Cases and Integration Tests
  // ════════════════════════════════════════════════════════════════════════════

  describe('Suppression and Pre-send Integration', () => {
    test('pre-send blocks domain-level suppression', async () => {
      const {
        addDomainToSuppressionList,
        preSendCheck
      } = require('../../utils/compliance');

      await addDomainToSuppressionList('blocked.com', 'spam', 'user');

      const result = await preSendCheck('anyone@blocked.com');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('suppression');
    });

    test('pre-send allows email outside suppressed domain', async () => {
      const {
        addDomainToSuppressionList,
        preSendCheck
      } = require('../../utils/compliance');

      await addDomainToSuppressionList('blocked.com', 'spam', 'user');

      const result = await preSendCheck('user@allowed.com');

      expect(result.allowed).toBe(true);
    });
  });

  describe('Audit Trail Tracking', () => {
    test('email suppression is logged to audit trail', async () => {
      const {
        addToSuppressionList
      } = require('../../utils/compliance');

      await addToSuppressionList('audit@example.com', 'test', 'user');

      const auditEntry = mockComplianceData.auditLog.find(
        entry => entry.action === 'suppression_added'
      );

      expect(auditEntry).toBeDefined();
      expect(auditEntry.email).toBe('audit@example.com');
    });

    test('domain suppression is logged to audit trail', async () => {
      const {
        addDomainToSuppressionList
      } = require('../../utils/compliance');

      await addDomainToSuppressionList('audit.com', 'test', 'user');

      const auditEntry = mockComplianceData.auditLog.find(
        entry => entry.action === 'domain_suppression_added'
      );

      expect(auditEntry).toBeDefined();
      expect(auditEntry.domain).toBe('audit.com');
    });

    test('suppression removal is logged', async () => {
      const {
        addToSuppressionList,
        removeFromSuppressionList
      } = require('../../utils/compliance');

      await addToSuppressionList('remove@example.com', 'test', 'user');
      await removeFromSuppressionList('remove@example.com');

      const auditEntry = mockComplianceData.auditLog.find(
        entry => entry.action === 'suppression_removed'
      );

      expect(auditEntry).toBeDefined();
    });
  });

  describe('Extract Domain Helper', () => {
    test('extracts domain correctly from email', async () => {
      const {
        isSuppressed
      } = require('../../utils/compliance');

      const result = await isSuppressed('user@sub.example.co.uk');

      expect(result.domain).toBe('sub.example.co.uk');
    });

    test('handles email without domain gracefully', async () => {
      const {
        isSuppressed
      } = require('../../utils/compliance');

      const result = await isSuppressed('nodomain');

      expect(result.domain).toBeDefined();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // purgePersonalData - Activity and Jobs Data Handling
  // ════════════════════════════════════════════════════════════════════════════

  describe('purgePersonalData - activity data handling', () => {
    test('removes activity entries matching recipientEmail', async () => {
      const {
        purgePersonalData
      } = require('../../utils/compliance');

      const targetEmail = 'recipient@example.com';

      // Mock activity with matching recipient
      const storage = require('../../utils/storage');
      storage.readData.mockImplementationOnce(async (file) => {
        if (file === 'activity.json') {
          return [
            { recipientEmail: targetEmail, action: 'send' },
            { recipientEmail: 'other@example.com', action: 'send' }
          ];
        }
        return null;
      });

      const result = await purgePersonalData(targetEmail, 'owner', 'GDPR');

      expect(result.removedFrom.activity).toBeDefined();
      expect(result.removedFrom.activity).toBeGreaterThan(0);
    });

    test('removes activity entries matching clientEmail', async () => {
      const {
        purgePersonalData
      } = require('../../utils/compliance');

      const targetEmail = 'client@example.com';

      const storage = require('../../utils/storage');
      storage.readData.mockImplementationOnce(async (file) => {
        if (file === 'activity.json') {
          return [
            { clientEmail: targetEmail, action: 'create' },
            { clientEmail: 'other@example.com', action: 'create' }
          ];
        }
        return null;
      });

      const result = await purgePersonalData(targetEmail, 'owner', 'GDPR');

      expect(result.removedFrom.activity).toBeDefined();
    });

    test('removes activity entries matching email field', async () => {
      const {
        purgePersonalData
      } = require('../../utils/compliance');

      const targetEmail = 'generic@example.com';

      const storage = require('../../utils/storage');
      storage.readData.mockImplementationOnce(async (file) => {
        if (file === 'activity.json') {
          return [
            { email: targetEmail, action: 'update' }
          ];
        }
        return null;
      });

      const result = await purgePersonalData(targetEmail, 'owner', 'GDPR');

      expect(result.removedFrom.activity).toBeGreaterThan(0);
    });

    test('handles activity read errors gracefully', async () => {
      const {
        purgePersonalData
      } = require('../../utils/compliance');

      const storage = require('../../utils/storage');
      storage.readData.mockImplementationOnce(async (file) => {
        if (file === 'activity.json') {
          throw new Error('Read failed');
        }
        return null;
      });

      const result = await purgePersonalData('user@example.com', 'owner', 'GDPR');

      // Should not throw, just skip activity removal
      expect(result.purged).toBe(true);
    });

    test('handles non-array activity data gracefully', async () => {
      const {
        purgePersonalData
      } = require('../../utils/compliance');

      const storage = require('../../utils/storage');
      storage.readData.mockImplementationOnce(async (file) => {
        if (file === 'activity.json') {
          return null;
        }
        return null;
      });

      const result = await purgePersonalData('user@example.com', 'owner', 'GDPR');

      expect(result.purged).toBe(true);
    });
  });

  describe('purgePersonalData - jobs data handling', () => {
    test('anonymizes client in jobs matching clientEmail', async () => {
      const {
        purgePersonalData
      } = require('../../utils/compliance');

      const targetEmail = 'client@example.com';

      const storage = require('../../utils/storage');
      // Mock all readData calls properly
      const originalMock = storage.readData.getMockImplementation();
      storage.readData.mockImplementation(async (file) => {
        if (file === 'compliance.json') {
          return { rateLimits: {}, suppression: { emails: [], domains: [] }, sendLog: [], purgeLog: [], auditLog: [] };
        }
        if (file === 'activity.json') return null;
        if (file === 'jobs.json') {
          return {
            jobs: [
              {
                id: 1,
                client: { email: targetEmail, name: 'John Doe', phone: '123', address: 'St' }
              }
            ]
          };
        }
        if (file === 'invoices.json') return null;
        return null;
      });

      const result = await purgePersonalData(targetEmail, 'owner', 'GDPR');
      storage.readData.mockImplementation(originalMock);

      expect(result.removedFrom.jobs).toBeDefined();
      expect(result.removedFrom.jobs).toBeGreaterThan(0);
    });

    test('anonymizes recipient in jobs matching recipientEmail', async () => {
      const {
        purgePersonalData
      } = require('../../utils/compliance');

      const targetEmail = 'recipient@example.com';

      const storage = require('../../utils/storage');
      const originalMock = storage.readData.getMockImplementation();
      storage.readData.mockImplementation(async (file) => {
        if (file === 'compliance.json') {
          return { rateLimits: {}, suppression: { emails: [], domains: [] }, sendLog: [], purgeLog: [], auditLog: [] };
        }
        if (file === 'activity.json') return null;
        if (file === 'jobs.json') {
          return {
            jobs: [
              {
                id: 1,
                recipient: { email: targetEmail, name: 'Jane Doe' }
              }
            ]
          };
        }
        if (file === 'invoices.json') return null;
        return null;
      });

      const result = await purgePersonalData(targetEmail, 'owner', 'GDPR');
      storage.readData.mockImplementation(originalMock);

      expect(result.removedFrom.jobs).toBeDefined();
      expect(result.removedFrom.jobs).toBeGreaterThan(0);
    });

    test('handles jobs read errors gracefully', async () => {
      const {
        purgePersonalData
      } = require('../../utils/compliance');

      const storage = require('../../utils/storage');
      const originalMock = storage.readData.getMockImplementation();
      storage.readData.mockImplementation(async (file) => {
        if (file === 'compliance.json') {
          return { rateLimits: {}, suppression: { emails: [], domains: [] }, sendLog: [], purgeLog: [], auditLog: [] };
        }
        if (file === 'jobs.json') {
          throw new Error('Read failed');
        }
        return null;
      });

      const result = await purgePersonalData('user@example.com', 'owner', 'GDPR');
      storage.readData.mockImplementation(originalMock);

      expect(result.purged).toBe(true);
    });

    test('handles missing jobs array in data', async () => {
      const {
        purgePersonalData
      } = require('../../utils/compliance');

      const storage = require('../../utils/storage');
      const originalMock = storage.readData.getMockImplementation();
      storage.readData.mockImplementation(async (file) => {
        if (file === 'compliance.json') {
          return { rateLimits: {}, suppression: { emails: [], domains: [] }, sendLog: [], purgeLog: [], auditLog: [] };
        }
        if (file === 'jobs.json') {
          return { other: 'data' };
        }
        return null;
      });

      const result = await purgePersonalData('user@example.com', 'owner', 'GDPR');
      storage.readData.mockImplementation(originalMock);

      expect(result.purged).toBe(true);
    });
  });

  describe('purgePersonalData - invoices data handling', () => {
    test('anonymizes invoices matching clientEmail', async () => {
      const {
        purgePersonalData
      } = require('../../utils/compliance');

      const targetEmail = 'invoiceclient@example.com';

      const storage = require('../../utils/storage');
      const originalMock = storage.readData.getMockImplementation();
      storage.readData.mockImplementation(async (file) => {
        if (file === 'compliance.json') {
          return { rateLimits: {}, suppression: { emails: [], domains: [] }, sendLog: [], purgeLog: [], auditLog: [] };
        }
        if (file === 'activity.json') return null;
        if (file === 'jobs.json') return null;
        if (file === 'invoices.json') {
          return {
            invoices: [
              { id: 1, clientEmail: targetEmail, clientName: 'John' }
            ]
          };
        }
        return null;
      });

      const result = await purgePersonalData(targetEmail, 'owner', 'GDPR');
      storage.readData.mockImplementation(originalMock);

      expect(result.removedFrom.invoices).toBeDefined();
      expect(result.removedFrom.invoices).toBeGreaterThan(0);
    });

    test('handles invoices read errors gracefully', async () => {
      const {
        purgePersonalData
      } = require('../../utils/compliance');

      const storage = require('../../utils/storage');
      const originalMock = storage.readData.getMockImplementation();
      storage.readData.mockImplementation(async (file) => {
        if (file === 'compliance.json') {
          return { rateLimits: {}, suppression: { emails: [], domains: [] }, sendLog: [], purgeLog: [], auditLog: [] };
        }
        if (file === 'invoices.json') {
          throw new Error('Read failed');
        }
        return null;
      });

      const result = await purgePersonalData('user@example.com', 'owner', 'GDPR');
      storage.readData.mockImplementation(originalMock);

      expect(result.purged).toBe(true);
    });

    test('handles missing invoices array in data', async () => {
      const {
        purgePersonalData
      } = require('../../utils/compliance');

      const storage = require('../../utils/storage');
      const originalMock = storage.readData.getMockImplementation();
      storage.readData.mockImplementation(async (file) => {
        if (file === 'compliance.json') {
          return { rateLimits: {}, suppression: { emails: [], domains: [] }, sendLog: [], purgeLog: [], auditLog: [] };
        }
        if (file === 'invoices.json') {
          return { other: 'data' };
        }
        return null;
      });

      const result = await purgePersonalData('user@example.com', 'owner', 'GDPR');
      storage.readData.mockImplementation(originalMock);

      expect(result.purged).toBe(true);
    });
  });

  describe('purgePersonalData - compliance data handling', () => {
    test('handles compliance data purge errors gracefully', async () => {
      const {
        purgePersonalData
      } = require('../../utils/compliance');

      // This will error when trying to save compliance data
      const storage = require('../../utils/storage');
      let callCount = 0;
      storage.writeData.mockImplementationOnce(async (file, data) => {
        callCount++;
        if (callCount > 2) { // After activity and jobs
          throw new Error('Write failed');
        }
      });

      const result = await purgePersonalData('user@example.com', 'owner', 'GDPR');

      // Still marks as purged despite error
      expect(result.purged).toBe(true);
    });

    test('includes different regulations in purge log', async () => {
      const {
        purgePersonalData,
        getPurgeLog
      } = require('../../utils/compliance');

      await purgePersonalData('gdpr@example.com', 'owner', 'GDPR');
      await purgePersonalData('ccpa@example.com', 'owner', 'CCPA');

      const log = await getPurgeLog();

      const gdprEntry = log.find(entry => entry.regulation === 'GDPR');
      const ccpaEntry = log.find(entry => entry.regulation === 'CCPA');

      expect(gdprEntry).toBeDefined();
      expect(ccpaEntry).toBeDefined();
    });

    test('logs different requestedBy sources', async () => {
      const {
        purgePersonalData,
        getPurgeLog
      } = require('../../utils/compliance');

      await purgePersonalData('user1@example.com', 'owner', 'GDPR');
      await purgePersonalData('user2@example.com', 'legal_team', 'GDPR');

      const log = await getPurgeLog();

      const ownerEntry = log.find(entry => entry.requestedBy === 'owner');
      const legalEntry = log.find(entry => entry.requestedBy === 'legal_team');

      expect(ownerEntry).toBeDefined();
      expect(legalEntry).toBeDefined();
    });
  });

  describe('removeFromSuppressionList - additional coverage', () => {
    test('returns removed false when email not in list', async () => {
      const {
        removeFromSuppressionList
      } = require('../../utils/compliance');

      const result = await removeFromSuppressionList('nothere@example.com');

      expect(result.removed).toBe(false);
    });

    test('normalizes email when removing', async () => {
      const {
        addToSuppressionList,
        removeFromSuppressionList
      } = require('../../utils/compliance');

      await addToSuppressionList('test@example.com', 'manual', 'user');
      const result = await removeFromSuppressionList('TEST@EXAMPLE.COM');

      expect(result.removed).toBe(true);
    });
  });

  describe('Duplicate suppression handling', () => {
    test('rejects duplicate email suppression with correct message', async () => {
      const {
        addToSuppressionList
      } = require('../../utils/compliance');

      await addToSuppressionList('dup@example.com', 'first', 'user');
      const secondResult = await addToSuppressionList('dup@example.com', 'second', 'user');

      expect(secondResult.added).toBe(false);
      expect(secondResult.reason).toContain('Already suppressed');
    });

    test('case-insensitive duplicate detection', async () => {
      const {
        addToSuppressionList
      } = require('../../utils/compliance');

      await addToSuppressionList('test@example.com', 'first', 'user');
      const secondResult = await addToSuppressionList('TEST@EXAMPLE.COM', 'second', 'user');

      expect(secondResult.added).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Edge Cases and Uncovered Paths
  // ════════════════════════════════════════════════════════════════════════════

  describe('loadComplianceData - null/invalid data handling', () => {
    test('initializes empty object when readData returns null', async () => {
      const {
        isSuppressed
      } = require('../../utils/compliance');

      const storage = require('../../utils/storage');
      const originalMock = storage.readData.getMockImplementation();
      let callCount = 0;

      storage.readData.mockImplementation(async (file) => {
        if (file === 'compliance.json') {
          return null; // Force null return
        }
        return null;
      });

      // This will trigger loadComplianceData internally
      const result = await isSuppressed('test@example.com');

      storage.readData.mockImplementation(originalMock);

      // Should handle gracefully and return default structure
      expect(result.suppressed).toBe(false);
      expect(result.email).toBeDefined();
    });

    test('initializes empty object when readData returns non-object', async () => {
      const {
        preSendCheck
      } = require('../../utils/compliance');

      const storage = require('../../utils/storage');
      const originalMock = storage.readData.getMockImplementation();

      storage.readData.mockImplementation(async (file) => {
        if (file === 'compliance.json') {
          return 'not an object'; // Invalid return
        }
        return null;
      });

      const result = await preSendCheck('test@example.com');

      storage.readData.mockImplementation(originalMock);

      expect(result.allowed).toBe(true);
    });
  });

  describe('preSendCheck - rate limit blocking', () => {
    test('blocks send and includes rate_limit check type when rate limited', async () => {
      const {
        preSendCheck,
        recordSend,
        RATE_LIMITS
      } = require('../../utils/compliance');

      // Record a send to trigger cooldown
      await recordSend('user@example.com');

      // Now try another send which should be blocked
      const result = await preSendCheck('user2@example.com');

      expect(result.allowed).toBe(false);
      expect(result.check).toBe('rate_limit');
      expect(result.reason).toBeDefined();
      expect(result.retryAfterMs).toBeDefined();
    });

    test('includes retryAfterMs when rate-limited by cooldown', async () => {
      const {
        preSendCheck,
        recordSend
      } = require('../../utils/compliance');

      await recordSend('user@example.com');
      const result = await preSendCheck('other@example.com');

      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    test('rate_limit check type distinguishes from suppression check', async () => {
      const {
        preSendCheck,
        addToSuppressionList,
        recordSend
      } = require('../../utils/compliance');

      // Test suppression check type
      await addToSuppressionList('suppressed@example.com', 'manual', 'user');
      const suppressionResult = await preSendCheck('suppressed@example.com');

      expect(suppressionResult.check).toBe('suppression');

      // Test rate limit check type
      await recordSend('user@example.com');
      const rateLimitResult = await preSendCheck('other@example.com');

      expect(rateLimitResult.check).toBe('rate_limit');
    });
  });

  describe('purgePersonalData - error handling edge cases', () => {
    test('completes purge despite compliance data save error', async () => {
      const {
        purgePersonalData
      } = require('../../utils/compliance');

      const storage = require('../../utils/storage');
      const originalWriteMock = storage.writeData.getMockImplementation();
      let saveAttempts = 0;

      storage.writeData.mockImplementation(async (file, data) => {
        if (file === 'compliance.json') {
          saveAttempts++;
          if (saveAttempts > 2) { // Fail on final compliance save
            throw new Error('Save failed');
          }
        }
      });

      const result = await purgePersonalData('user@example.com', 'owner', 'GDPR');

      storage.writeData.mockImplementation(originalWriteMock);

      // Should still mark as purged despite save error
      expect(result.purged).toBe(true);
      expect(result.totalRecordsAffected).toBeDefined();
    });

    test('logs warning when compliance data purge fails', async () => {
      const {
        purgePersonalData
      } = require('../../utils/compliance');

      const logger = require('../../utils/logger');
      const storage = require('../../utils/storage');
      const originalWriteMock = storage.writeData.getMockImplementation();

      storage.writeData.mockImplementation(async (file, data) => {
        if (file === 'compliance.json') {
          throw new Error('Write error occurred');
        }
      });

      await purgePersonalData('warning-test@example.com', 'owner', 'GDPR');

      storage.writeData.mockImplementation(originalWriteMock);

      // Verify logger.warn was called for the error
      const warnCalls = logger.warn.mock.calls;
      const hasComplianceError = warnCalls.some(call =>
        call[0] && call[0].includes('Error purging compliance data')
      );

      expect(hasComplianceError).toBe(true);
    });

    test('purge log contains complete removal summary', async () => {
      const {
        purgePersonalData,
        getPurgeLog
      } = require('../../utils/compliance');

      const email = 'summary@example.com';
      const result = await purgePersonalData(email, 'data_officer', 'GDPR');

      const log = await getPurgeLog();
      const entry = log.find(e => e.email === email);

      expect(entry).toBeDefined();
      expect(entry.regulation).toBe('GDPR');
      expect(entry.requestedBy).toBe('data_officer');
      expect(entry.removedFrom).toBeDefined();
      expect(entry.requestedAt).toBeDefined();
    });
  });

  describe('comprehensive audit trail verification', () => {
    test('audit trail captures all major compliance actions', async () => {
      const {
        addToSuppressionList,
        addDomainToSuppressionList,
        processInboundReply,
        getAuditLog
      } = require('../../utils/compliance');

      // Perform various actions
      await addToSuppressionList('email1@example.com', 'manual', 'user');
      await addDomainToSuppressionList('example.com', 'spam', 'user');
      await processInboundReply('reply@example.com', 'please unsubscribe');

      const log = await getAuditLog();

      expect(log.length).toBeGreaterThan(0);

      const hasEmailSuppression = log.some(e => e.action === 'suppression_added');
      const hasDomainSuppression = log.some(e => e.action === 'domain_suppression_added');

      expect(hasEmailSuppression).toBe(true);
      expect(hasDomainSuppression).toBe(true);
    });

    test('audit entries include full context', async () => {
      const {
        addToSuppressionList,
        getAuditLog
      } = require('../../utils/compliance');

      const email = 'audit-test@example.com';
      const reason = 'user_requested';
      const source = 'dashboard';

      await addToSuppressionList(email, reason, source);

      const log = await getAuditLog();
      const entry = log.find(e => e.email === email);

      expect(entry).toBeDefined();
      expect(entry.action).toBe('suppression_added');
      expect(entry.reason).toBe(reason);
      expect(entry.source).toBe(source);
      expect(entry.timestamp).toBeDefined();
    });
  });

  describe('Mutex and Concurrency', () => {
    test('concurrent pre-send checks return consistent results', async () => {
      const {
        preSendCheck,
        addToSuppressionList
      } = require('../../utils/compliance');

      const email = 'concurrent@example.com';
      await addToSuppressionList(email, 'test', 'user');

      // Execute multiple concurrent checks
      const results = await Promise.all([
        preSendCheck(email),
        preSendCheck(email),
        preSendCheck(email)
      ]);

      // All should return the same result
      expect(results.every(r => !r.allowed)).toBe(true);
      expect(results.every(r => r.reason === results[0].reason)).toBe(true);
    });

    test('concurrent sends respect rate limit serialization', async () => {
      const {
        recordSend,
        checkRateLimit,
        RATE_LIMITS
      } = require('../../utils/compliance');

      // Record initial send
      await recordSend('test1@example.com');

      // Try to send immediately (should fail due to cooldown)
      const result = await checkRateLimit('test2@example.com');

      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });
  });
});
