/**
 * Delivery Notifier
 * Sends email notifications when content is delivered to a client.
 * Uses the Gmail service (mock or real) via serviceFactory.
 *
 * Automatically triggers after delivery in the orchestrator's DELIVERED hook.
 */

const logger = require('./logger');
const serviceFactory = require('./serviceFactory');
const { resolveBranding } = require('./deliveryFormats');

/**
 * Send a delivery notification email to the client.
 *
 * @param {Object} job - The delivered job
 * @param {Object[]} deliveryResults - Array of delivery result objects from generateDeliverables
 * @returns {Promise<Object>} Send result or null if skipped
 */
async function notifyClientDelivery(job, deliveryResults = []) {
  const client = job.client || {};

  if (!client.email) {
    logger.info('[deliveryNotifier] No client email — skipping notification', { jobId: job.id || job.jobId });
    return null;
  }

  const brand = resolveBranding(job);
  const contentTitle = job.content?.title || job.topic || job.title || 'your content';
  const deliveredDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });

  // Build attachment/link summary
  const formatSummary = deliveryResults
    .filter(r => r.status !== 'failed' && r.status !== 'unsupported')
    .map(r => {
      if (r.format === 'google_docs' && r.url) return `  • Google Doc: ${r.url}`;
      if (r.format === 'pdf') return `  • PDF: ${r.filename}`;
      if (r.format === 'html') return `  • Web-ready HTML: ${r.filename}`;
      if (r.format === 'markdown') return `  • Markdown source: ${r.filename}`;
      return `  • ${r.format}: ${r.filename || r.url || 'attached'}`;
    })
    .join('\n');

  const subject = `Your content is ready: "${contentTitle}"`;

  const body = [
    `Hi ${client.name || 'there'},`,
    '',
    `Great news — "${contentTitle}" has been completed and is ready for your review.`,
    '',
    'Deliverables:',
    formatSummary || '  (see attachments)',
    '',
    `Delivered on ${deliveredDate}.`,
    '',
    'Please review and let us know if you need any revisions.',
    '',
    'Best regards,',
    `${brand.companyName}`,
    brand.website ? brand.website : ''
  ].join('\n');

  try {
    const gmail = serviceFactory.getService('gmail');

    const result = await gmail.sendMessage({
      to: client.email,
      from: `delivery@${brand.companyName.toLowerCase().replace(/\s+/g, '')}.com`,
      subject,
      body
    });

    logger.info('[deliveryNotifier] Notification sent', {
      jobId: job.id || job.jobId,
      to: client.email,
      messageId: result.id
    });

    return {
      sent: true,
      messageId: result.id,
      to: client.email,
      subject
    };
  } catch (err) {
    logger.warn('[deliveryNotifier] Failed to send notification', {
      jobId: job.id || job.jobId,
      to: client.email,
      error: err.message
    });
    return { sent: false, error: err.message };
  }
}

module.exports = { notifyClientDelivery };
