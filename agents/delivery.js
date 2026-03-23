/**
 * Delivery Agent
 * Handles content delivery in multiple client-requested formats.
 * Delegates format generation to utils/deliveryFormats and notification
 * to utils/deliveryNotifier.
 *
 * Supported formats: markdown, pdf, html, google_docs
 * Branding: KAIL default or white-label per client config
 */

const { generateDeliverables } = require('../utils/deliveryFormats');
const { notifyClientDelivery } = require('../utils/deliveryNotifier');
const { appendToArray } = require('../utils/storage');
const { getPromptManager } = require('../utils/promptManager');
const logger = require('../utils/logger');

/**
 * Deliver content in requested format(s) and notify the client.
 *
 * @param {Object} job - Job object
 * @param {Object} job.content - { title, body } content to deliver
 * @param {Array}  job.deliveryFormats - Formats to deliver (markdown, pdf, html, google_docs)
 * @param {Object} job.client - Client info (name, email, whiteLabel, brand, deliveryFormats)
 * @param {Object} context - Optional orchestrator context
 * @returns {Promise<Object>} Delivery record with file locations
 */
async function delivery(job, context = {}) {
  const jobId = job.jobId || job.id || `delivery_${Date.now()}`;

  try {
    logger.info(`[delivery] Preparing content delivery for job ${jobId}`);

    const content = job.content || {};

    // Resolve formats: job-level → client-level → default
    const formats = job.deliveryFormats
      || job.client?.deliveryFormats
      || ['markdown'];

    // ── Generate all deliverables ────────────────────────
    const deliveryResults = await generateDeliverables(job, content, { formats });

    const succeeded = deliveryResults.filter(r => r.status !== 'failed' && r.status !== 'unsupported');
    const failed = deliveryResults.filter(r => r.status === 'failed');

    // ── Send client notification email ───────────────────
    let notification = null;
    try {
      notification = await notifyClientDelivery(job, deliveryResults);
    } catch (notifyErr) {
      // Non-blocking — delivery succeeds even if notification fails
      logger.warn(`[delivery] Notification failed for job ${jobId}`, { error: notifyErr.message });
    }

    // ── Track prompt version ─────────────────────────────
    const promptManager = getPromptManager();
    const prompt = promptManager.getPrompt('delivery');
    if (prompt) {
      promptManager.trackJobPromptVersion(jobId, 'delivery', prompt.version);
    }

    // ── Prepare delivery record ──────────────────────────
    const deliveryData = {
      id: jobId,
      contentTitle: content.title || 'Untitled',
      formatsRequested: formats,
      deliveryResults,
      succeededCount: succeeded.length,
      failedCount: failed.length,
      clientEmail: job.client?.email,
      notification,
      deliveredAt: new Date().toISOString(),
      status: 'delivered'
    };

    // ── Log activity ─────────────────────────────────────
    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'delivery',
      jobId,
      action: 'content_delivered',
      contentTitle: content.title || 'Untitled',
      formats: formats.join(', '),
      fileCount: succeeded.length,
      notificationSent: notification?.sent || false,
      status: 'completed'
    });

    logger.info(`[delivery] Content delivered for job ${jobId}: ${succeeded.length} files in ${formats.join(', ')} format(s)`);

    return deliveryData;
  } catch (error) {
    logger.error(`[delivery] Error delivering content for job ${jobId}:`, error);

    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'delivery',
      jobId,
      action: 'delivery_failed',
      error: error.message,
      status: 'error'
    }).catch(() => {});

    throw error;
  }
}

module.exports = delivery;
