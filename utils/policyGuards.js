/**
 * Policy Guards — Deterministic business rules that gate external actions.
 *
 * These are code-level rules, not model judgment.
 * They run BEFORE any external action and can block it.
 */

const { readData } = require('./storage');
const { preSendCheck } = require('./compliance');
const logger = require('./logger');

const MOCK_MODE = process.env.MOCK_MODE === 'true';

// ── Configurable policy limits ────────────────────────────────────────
const POLICY = {
  // Email / outreach
  maxEmailsPerLeadPerWeek: 2,
  maxEmailsPerDomainPerDay: 25,
  maxTotalEmailsPerDay: 100,
  sendWindowStart: 8,    // 8 AM local
  sendWindowEnd: 18,     // 6 PM local
  enforceSendWindow: true,

  // Delivery
  requireContentBeforeDelivery: true,
  requireClientEmailForNotification: true,

  // Invoice
  requireDeliveryBeforeInvoice: true,
  maxInvoiceAmountUSD: 10000,

  // General
  requireKillSwitchOff: true,
};

/**
 * Validate an email send action.
 */
async function validateEmailSend(input) {
  const { recipientEmail, jobId } = input;

  if (!recipientEmail) {
    return { allowed: false, reason: 'No recipient email provided', check: 'missing_email' };
  }

  // Basic email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
    return { allowed: false, reason: 'Invalid email format', check: 'invalid_email' };
  }

  // Send window check
  if (POLICY.enforceSendWindow && !MOCK_MODE) {
    const hour = new Date().getHours();
    if (hour < POLICY.sendWindowStart || hour >= POLICY.sendWindowEnd) {
      return { allowed: false, reason: `Outside send window (${POLICY.sendWindowStart}:00-${POLICY.sendWindowEnd}:00)`, check: 'send_window' };
    }
  }

  // Compliance check (suppression + rate limits)
  try {
    const compliance = await preSendCheck(recipientEmail);
    if (!compliance.allowed) {
      return { allowed: false, reason: compliance.reason, check: compliance.check || 'compliance' };
    }
  } catch (err) {
    // Fail closed
    return { allowed: false, reason: `Compliance check error: ${err.message}`, check: 'compliance_error' };
  }

  return { allowed: true };
}

/**
 * Validate a delivery action.
 */
async function validateDelivery(input) {
  const { jobId, content, formats } = input;

  if (!jobId) {
    return { allowed: false, reason: 'No job ID for delivery', check: 'missing_job_id' };
  }

  if (POLICY.requireContentBeforeDelivery) {
    if (!content || (!content.body && typeof content !== 'string')) {
      return { allowed: false, reason: 'No content body for delivery', check: 'missing_content' };
    }
  }

  if (!formats || !Array.isArray(formats) || formats.length === 0) {
    return { allowed: false, reason: 'No delivery formats specified', check: 'missing_formats' };
  }

  return { allowed: true };
}

/**
 * Validate an invoice generation action.
 */
async function validateInvoiceGeneration(input) {
  const { jobId, amount } = input;

  if (!jobId) {
    return { allowed: false, reason: 'No job ID for invoice', check: 'missing_job_id' };
  }

  if (POLICY.requireDeliveryBeforeInvoice) {
    // Check if the job has actually been delivered
    try {
      const jobsData = await readData('jobs.json');
      const jobs = (jobsData && jobsData.jobs) || [];
      const job = jobs.find(j => j.id === jobId);
      if (!job || (job.state !== 'DELIVERED' && job.state !== 'CLOSED')) {
        return { allowed: false, reason: `Job ${jobId} not in delivered state (current: ${job?.state || 'unknown'})`, check: 'not_delivered' };
      }
    } catch (err) {
      return { allowed: false, reason: `Could not verify job state: ${err.message}`, check: 'state_check_error' };
    }
  }

  if (amount !== undefined && amount > POLICY.maxInvoiceAmountUSD) {
    return { allowed: false, reason: `Invoice amount $${amount} exceeds max $${POLICY.maxInvoiceAmountUSD}`, check: 'amount_exceeded' };
  }

  return { allowed: true };
}

/**
 * Validate a client notification action.
 */
async function validateNotification(input) {
  const { clientEmail, jobId } = input;

  if (!clientEmail) {
    return { allowed: false, reason: 'No client email for notification', check: 'missing_email' };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) {
    return { allowed: false, reason: 'Invalid client email format', check: 'invalid_email' };
  }

  return { allowed: true };
}

module.exports = {
  validateEmailSend,
  validateDelivery,
  validateInvoiceGeneration,
  validateNotification,
  POLICY
};
