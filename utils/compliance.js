/**
 * Compliance Guardrails
 *
 * Three subsystems:
 *   1. Rate Limiter  — enforces outreach send limits per domain and globally
 *   2. Suppression   — opt-out detection + manual suppression list
 *   3. Data Retention — manual GDPR/CCPA purge (no auto-purge)
 *
 * All state is persisted to compliance.json via the storage layer.
 */

const { readData, writeData, appendToArray } = require('./storage');
const logger = require('./logger');

// ── Mutex for serializing rate-limit read-check-write cycles ─────────

let _rateLimitLock = Promise.resolve();

/**
 * Acquire a simple async mutex so concurrent sends don't race
 * on the load → check → write cycle.
 * @param {Function} fn - Critical section (async)
 * @returns {Promise} Result of fn()
 */
function withRateLimitLock(fn) {
  let release;
  const next = new Promise(resolve => { release = resolve; });
  const prev = _rateLimitLock;
  _rateLimitLock = next;
  return prev.then(async () => {
    try {
      return await fn();
    } finally {
      release();
    }
  });
}

// ── Constants ────────────────────────────────────────────────────────

const COMPLIANCE_FILE = 'compliance.json';

/** Moderate rate-limit profile */
const RATE_LIMITS = {
  maxPerDomainPerDay: 25,
  maxTotalPerDay: 100,
  cooldownMs: 2 * 60 * 1000  // 2 minutes between sends
};

/** Keywords that indicate an opt-out / unsubscribe request */
const OPT_OUT_KEYWORDS = [
  'unsubscribe',
  'opt out',
  'opt-out',
  'stop emailing',
  'stop contacting',
  'remove me',
  'take me off',
  'do not contact',
  'do not email',
  'no more emails',
  'leave me alone',
  'not interested',
  'remove from list',
  'cancel subscription'
];

// ── Helpers ──────────────────────────────────────────────────────────

function extractDomain(email) {
  if (!email || typeof email !== 'string') return 'unknown';
  const parts = email.split('@');
  return parts.length > 1 ? parts[1].toLowerCase() : 'unknown';
}

/** Basic email format validation */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_REGEX.test(email.trim());
}

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Load or initialize the compliance data store.
 */
async function loadComplianceData() {
  let data = await readData(COMPLIANCE_FILE);
  if (!data || typeof data !== 'object') {
    data = {};
  }
  // Ensure shape
  if (!data.rateLimits) data.rateLimits = {};
  if (!data.suppression) data.suppression = { emails: [], domains: [] };
  if (!data.sendLog) data.sendLog = [];
  if (!data.purgeLog) data.purgeLog = [];
  if (!data.auditLog) data.auditLog = [];
  return data;
}

async function saveComplianceData(data) {
  await writeData(COMPLIANCE_FILE, data);
}

// ═════════════════════════════════════════════════════════════════════
// 1. RATE LIMITER
// ═════════════════════════════════════════════════════════════════════

/**
 * Check whether an outreach send to `recipientEmail` is allowed.
 * Returns { allowed: true } or { allowed: false, reason, retryAfterMs }.
 */
async function checkRateLimit(recipientEmail) {
  const data = await loadComplianceData();
  const today = todayKey();
  const domain = extractDomain(recipientEmail);
  const now = Date.now();

  // Ensure today's counters exist
  if (!data.rateLimits[today]) {
    data.rateLimits[today] = { total: 0, domains: {}, lastSendAt: 0 };
  }
  const dayData = data.rateLimits[today];

  // 1. Cooldown check
  if (dayData.lastSendAt && (now - dayData.lastSendAt) < RATE_LIMITS.cooldownMs) {
    const retryAfterMs = RATE_LIMITS.cooldownMs - (now - dayData.lastSendAt);
    return {
      allowed: false,
      reason: `Cooldown active — wait ${Math.ceil(retryAfterMs / 1000)}s between sends`,
      retryAfterMs
    };
  }

  // 2. Global daily limit
  if (dayData.total >= RATE_LIMITS.maxTotalPerDay) {
    return {
      allowed: false,
      reason: `Daily send limit reached (${RATE_LIMITS.maxTotalPerDay}/day)`,
      retryAfterMs: null
    };
  }

  // 3. Per-domain daily limit
  const domainCount = dayData.domains[domain] || 0;
  if (domainCount >= RATE_LIMITS.maxPerDomainPerDay) {
    return {
      allowed: false,
      reason: `Domain limit reached for ${domain} (${RATE_LIMITS.maxPerDomainPerDay}/day)`,
      retryAfterMs: null
    };
  }

  return { allowed: true };
}

/**
 * Record that a send occurred (call AFTER successful send).
 * Serialized via mutex to prevent concurrent writes from racing.
 */
async function recordSend(recipientEmail) {
  return withRateLimitLock(async () => {
    const data = await loadComplianceData();
    const today = todayKey();
    const domain = extractDomain(recipientEmail);
    const now = Date.now();

    if (!data.rateLimits[today]) {
      data.rateLimits[today] = { total: 0, domains: {}, lastSendAt: 0 };
    }

    data.rateLimits[today].total += 1;
    data.rateLimits[today].domains[domain] = (data.rateLimits[today].domains[domain] || 0) + 1;
    data.rateLimits[today].lastSendAt = now;

    data.sendLog.push({
      email: recipientEmail,
      domain,
      sentAt: new Date(now).toISOString()
    });

    // Keep send log to last 1000 entries
    if (data.sendLog.length > 1000) {
      data.sendLog = data.sendLog.slice(-1000);
    }

    await saveComplianceData(data);

    logger.info('[compliance] Send recorded', { email: recipientEmail, domain, dailyTotal: data.rateLimits[today].total });
  });
}

/**
 * Get current rate-limit status for the dashboard.
 */
async function getRateLimitStatus() {
  const data = await loadComplianceData();
  const today = todayKey();
  const dayData = data.rateLimits[today] || { total: 0, domains: {}, lastSendAt: 0 };

  return {
    date: today,
    totalSent: dayData.total,
    maxTotal: RATE_LIMITS.maxTotalPerDay,
    remainingTotal: Math.max(0, RATE_LIMITS.maxTotalPerDay - dayData.total),
    domains: dayData.domains,
    maxPerDomain: RATE_LIMITS.maxPerDomainPerDay,
    cooldownMs: RATE_LIMITS.cooldownMs,
    lastSendAt: dayData.lastSendAt ? new Date(dayData.lastSendAt).toISOString() : null,
    limits: RATE_LIMITS
  };
}

// ═════════════════════════════════════════════════════════════════════
// 2. SUPPRESSION / OPT-OUT
// ═════════════════════════════════════════════════════════════════════

/**
 * Check whether an email or its domain is suppressed.
 */
async function isSuppressed(email) {
  const data = await loadComplianceData();
  const normalizedEmail = (email || '').toLowerCase().trim();
  const domain = extractDomain(normalizedEmail);

  const emailSuppressed = data.suppression.emails.some(
    entry => entry.email === normalizedEmail
  );
  const domainSuppressed = data.suppression.domains.some(
    entry => entry.domain === domain
  );

  return {
    suppressed: emailSuppressed || domainSuppressed,
    emailMatch: emailSuppressed,
    domainMatch: domainSuppressed,
    email: normalizedEmail,
    domain
  };
}

/**
 * Add an email to the suppression list (manual or auto-detected).
 */
async function addToSuppressionList(email, reason = 'manual', source = 'user') {
  const data = await loadComplianceData();
  const normalizedEmail = (email || '').toLowerCase().trim();

  if (!normalizedEmail) return { added: false, reason: 'Empty email' };
  if (!isValidEmail(normalizedEmail)) return { added: false, reason: 'Invalid email format' };

  // Check for duplicate
  const exists = data.suppression.emails.some(entry => entry.email === normalizedEmail);
  if (exists) return { added: false, reason: 'Already suppressed' };

  const entry = {
    email: normalizedEmail,
    domain: extractDomain(normalizedEmail),
    reason,
    source,        // 'auto_detect' or 'user'
    addedAt: new Date().toISOString()
  };

  data.suppression.emails.push(entry);

  // Audit log
  data.auditLog.push({
    action: 'suppression_added',
    email: normalizedEmail,
    reason,
    source,
    timestamp: new Date().toISOString()
  });

  await saveComplianceData(data);
  logger.info('[compliance] Email added to suppression list', { email: normalizedEmail, reason, source });

  return { added: true, entry };
}

/**
 * Add an entire domain to the suppression list.
 */
async function addDomainToSuppressionList(domain, reason = 'manual', source = 'user') {
  const data = await loadComplianceData();
  const normalizedDomain = (domain || '').toLowerCase().trim();

  if (!normalizedDomain) return { added: false, reason: 'Empty domain' };

  const exists = data.suppression.domains.some(entry => entry.domain === normalizedDomain);
  if (exists) return { added: false, reason: 'Already suppressed' };

  const entry = {
    domain: normalizedDomain,
    reason,
    source,
    addedAt: new Date().toISOString()
  };

  data.suppression.domains.push(entry);

  data.auditLog.push({
    action: 'domain_suppression_added',
    domain: normalizedDomain,
    reason,
    source,
    timestamp: new Date().toISOString()
  });

  await saveComplianceData(data);
  logger.info('[compliance] Domain added to suppression list', { domain: normalizedDomain, reason, source });

  return { added: true, entry };
}

/**
 * Remove an email from the suppression list.
 */
async function removeFromSuppressionList(email) {
  const data = await loadComplianceData();
  const normalizedEmail = (email || '').toLowerCase().trim();
  const before = data.suppression.emails.length;

  data.suppression.emails = data.suppression.emails.filter(
    entry => entry.email !== normalizedEmail
  );

  const removed = data.suppression.emails.length < before;

  if (removed) {
    data.auditLog.push({
      action: 'suppression_removed',
      email: normalizedEmail,
      timestamp: new Date().toISOString()
    });
    await saveComplianceData(data);
    logger.info('[compliance] Email removed from suppression list', { email: normalizedEmail });
  }

  return { removed };
}

/**
 * Remove a domain from the suppression list.
 */
async function removeDomainFromSuppressionList(domain) {
  const data = await loadComplianceData();
  const normalizedDomain = (domain || '').toLowerCase().trim();
  const before = data.suppression.domains.length;

  data.suppression.domains = data.suppression.domains.filter(
    entry => entry.domain !== normalizedDomain
  );

  const removed = data.suppression.domains.length < before;

  if (removed) {
    data.auditLog.push({
      action: 'domain_suppression_removed',
      domain: normalizedDomain,
      timestamp: new Date().toISOString()
    });
    await saveComplianceData(data);
    logger.info('[compliance] Domain removed from suppression list', { domain: normalizedDomain });
  }

  return { removed };
}

/**
 * Scan a message body for opt-out keywords.
 * Returns { isOptOut: boolean, matchedKeywords: string[] }.
 */
function detectOptOut(messageBody) {
  if (!messageBody || typeof messageBody !== 'string') {
    return { isOptOut: false, matchedKeywords: [] };
  }

  const lower = messageBody.toLowerCase();
  const matchedKeywords = OPT_OUT_KEYWORDS.filter(kw => lower.includes(kw));

  return {
    isOptOut: matchedKeywords.length > 0,
    matchedKeywords
  };
}

/**
 * Process an inbound reply — auto-detect opt-out and suppress if found.
 */
async function processInboundReply(senderEmail, messageBody) {
  if (!isValidEmail(senderEmail)) {
    logger.warn('[compliance] processInboundReply called with invalid email', { email: senderEmail });
    return { optOutDetected: false, error: 'Invalid sender email format' };
  }

  const detection = detectOptOut(messageBody);

  if (detection.isOptOut) {
    const result = await addToSuppressionList(
      senderEmail,
      `Auto-detected opt-out: ${detection.matchedKeywords.join(', ')}`,
      'auto_detect'
    );

    logger.info('[compliance] Auto-detected opt-out from inbound reply', {
      email: senderEmail,
      keywords: detection.matchedKeywords
    });

    return {
      optOutDetected: true,
      suppressed: result.added,
      keywords: detection.matchedKeywords
    };
  }

  return { optOutDetected: false };
}

/**
 * Get the full suppression list for the dashboard.
 */
async function getSuppressionList() {
  const data = await loadComplianceData();
  return {
    emails: data.suppression.emails,
    domains: data.suppression.domains,
    totalEmails: data.suppression.emails.length,
    totalDomains: data.suppression.domains.length
  };
}

// ═════════════════════════════════════════════════════════════════════
// 3. DATA RETENTION — Manual Purge (GDPR/CCPA)
// ═════════════════════════════════════════════════════════════════════

/**
 * Purge all data associated with a specific email address.
 * Removes from: jobs, activity, invoices, send logs, suppression list.
 * Logs the purge action for audit trail.
 *
 * @param {string} email - Email to purge
 * @param {string} requestedBy - Who requested the purge
 * @param {string} regulation - 'GDPR', 'CCPA', or 'manual'
 * @returns {Promise<Object>} Purge summary
 */
async function purgePersonalData(email, requestedBy = 'owner', regulation = 'manual') {
  const normalizedEmail = (email || '').toLowerCase().trim();
  if (!normalizedEmail) {
    return { purged: false, reason: 'Empty email provided' };
  }

  const summary = {
    email: normalizedEmail,
    regulation,
    requestedBy,
    requestedAt: new Date().toISOString(),
    removedFrom: {}
  };

  // 1. Purge from activity.json
  try {
    const activity = await readData('activity.json');
    if (Array.isArray(activity)) {
      const before = activity.length;
      const filtered = activity.filter(entry =>
        !((entry.recipientEmail || '').toLowerCase() === normalizedEmail ||
          (entry.clientEmail || '').toLowerCase() === normalizedEmail ||
          (entry.email || '').toLowerCase() === normalizedEmail)
      );
      if (filtered.length < before) {
        await writeData('activity.json', filtered);
        summary.removedFrom.activity = before - filtered.length;
      }
    }
  } catch (err) {
    logger.warn('[compliance] Error purging activity', { error: err.message });
  }

  // 2. Purge from jobs.json — anonymize client fields
  try {
    const jobsData = await readData('jobs.json');
    const jobs = (jobsData && jobsData.jobs) || [];
    let anonymized = 0;
    for (const job of jobs) {
      if (job.client?.email?.toLowerCase() === normalizedEmail ||
          job.recipient?.email?.toLowerCase() === normalizedEmail) {
        // Anonymize rather than delete — preserves job history without PII
        if (job.client) {
          job.client.email = '[REDACTED]';
          job.client.name = '[REDACTED]';
          if (job.client.phone) job.client.phone = '[REDACTED]';
          if (job.client.address) job.client.address = '[REDACTED]';
        }
        if (job.recipient) {
          job.recipient.email = '[REDACTED]';
          job.recipient.name = '[REDACTED]';
        }
        anonymized++;
      }
    }
    if (anonymized > 0) {
      await writeData('jobs.json', { ...jobsData, jobs });
      summary.removedFrom.jobs = anonymized;
    }
  } catch (err) {
    logger.warn('[compliance] Error purging jobs', { error: err.message });
  }

  // 3. Purge from invoices.json
  try {
    const invoicesData = await readData('invoices.json');
    const invoices = (invoicesData && invoicesData.invoices) || [];
    let anonymized = 0;
    for (const inv of invoices) {
      if (inv.clientEmail?.toLowerCase() === normalizedEmail) {
        inv.clientEmail = '[REDACTED]';
        inv.clientName = '[REDACTED]';
        anonymized++;
      }
    }
    if (anonymized > 0) {
      await writeData('invoices.json', { ...invoicesData, invoices });
      summary.removedFrom.invoices = anonymized;
    }
  } catch (err) {
    logger.warn('[compliance] Error purging invoices', { error: err.message });
  }

  // 4. Purge from compliance send log
  try {
    const compData = await loadComplianceData();
    const beforeSendLog = compData.sendLog.length;
    compData.sendLog = compData.sendLog.filter(
      entry => (entry.email || '').toLowerCase() !== normalizedEmail
    );
    if (compData.sendLog.length < beforeSendLog) {
      summary.removedFrom.sendLog = beforeSendLog - compData.sendLog.length;
    }

    // Remove from suppression list too (they requested data deletion)
    const beforeEmails = compData.suppression.emails.length;
    compData.suppression.emails = compData.suppression.emails.filter(
      entry => entry.email !== normalizedEmail
    );
    if (compData.suppression.emails.length < beforeEmails) {
      summary.removedFrom.suppressionList = beforeEmails - compData.suppression.emails.length;
    }

    // Record purge in audit log (audit log itself is retained for legal compliance)
    compData.purgeLog.push({
      email: normalizedEmail,
      regulation,
      requestedBy,
      requestedAt: summary.requestedAt,
      removedFrom: summary.removedFrom
    });

    compData.auditLog.push({
      action: 'data_purge',
      email: normalizedEmail,
      regulation,
      requestedBy,
      removedFrom: summary.removedFrom,
      timestamp: summary.requestedAt
    });

    await saveComplianceData(compData);
  } catch (err) {
    logger.warn('[compliance] Error purging compliance data', { error: err.message });
  }

  const totalRemoved = Object.values(summary.removedFrom).reduce((a, b) => a + b, 0);
  summary.purged = true;
  summary.totalRecordsAffected = totalRemoved;

  logger.info('[compliance] Personal data purged', {
    email: normalizedEmail,
    regulation,
    totalRecordsAffected: totalRemoved
  });

  return summary;
}

/**
 * Get audit log of all compliance actions.
 */
async function getAuditLog(limit = 100) {
  const data = await loadComplianceData();
  return data.auditLog.slice(-limit).reverse();
}

/**
 * Get purge history.
 */
async function getPurgeLog() {
  const data = await loadComplianceData();
  return data.purgeLog;
}

/**
 * Get full compliance dashboard summary.
 */
async function getComplianceSummary() {
  const [rateLimits, suppression, purgeLog, auditLog] = await Promise.all([
    getRateLimitStatus(),
    getSuppressionList(),
    getPurgeLog(),
    getAuditLog(20)
  ]);

  return {
    rateLimits,
    suppression,
    purgeLog,
    recentAuditLog: auditLog,
    config: {
      rateLimits: RATE_LIMITS,
      optOutKeywords: OPT_OUT_KEYWORDS
    }
  };
}

// ═════════════════════════════════════════════════════════════════════
// PRE-SEND GUARD — single function agents call before any outreach
// ═════════════════════════════════════════════════════════════════════

/**
 * Full pre-send compliance check. Call before every outbound email.
 * Returns { allowed, reason } — if not allowed, DO NOT SEND.
 * Serialized via mutex so concurrent callers see consistent rate-limit state.
 */
async function preSendCheck(recipientEmail) {
  // 1. Suppression check (read-only, safe outside mutex)
  const suppression = await isSuppressed(recipientEmail);
  if (suppression.suppressed) {
    const match = suppression.emailMatch ? 'email' : 'domain';
    return {
      allowed: false,
      reason: `Recipient is on suppression list (${match} match)`,
      check: 'suppression'
    };
  }

  // 2. Rate limit check (serialized to avoid TOCTOU race)
  return withRateLimitLock(async () => {
    const rateLimit = await checkRateLimit(recipientEmail);
    if (!rateLimit.allowed) {
      return {
        allowed: false,
        reason: rateLimit.reason,
        retryAfterMs: rateLimit.retryAfterMs,
        check: 'rate_limit'
      };
    }

    return { allowed: true };
  });
}

module.exports = {
  // Rate Limiter
  checkRateLimit,
  recordSend,
  getRateLimitStatus,
  RATE_LIMITS,

  // Suppression / Opt-Out
  isSuppressed,
  addToSuppressionList,
  addDomainToSuppressionList,
  removeFromSuppressionList,
  removeDomainFromSuppressionList,
  detectOptOut,
  processInboundReply,
  getSuppressionList,
  OPT_OUT_KEYWORDS,

  // Data Retention / Purge
  purgePersonalData,
  getAuditLog,
  getPurgeLog,

  // Dashboard
  getComplianceSummary,

  // Pre-Send Guard
  preSendCheck
};
