/**
 * Delivery Agent
 * Handles content delivery in multiple client-requested formats
 * Generates Google Docs, PDFs, and Markdown files
 */

const ApiClient = require('../utils/apiClient');
const serviceFactory = require('../utils/serviceFactory');
const { readData, writeData, appendToArray } = require('../utils/storage');
const { getPromptManager } = require('../utils/promptManager');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

/**
 * Deliver content in requested format(s)
 * @param {Object} job - Job object
 * @param {string} job.jobId - Unique job identifier
 * @param {Object} job.content - Content to deliver
 * @param {string} job.content.title - Content title
 * @param {string} job.content.body - Content body
 * @param {Array} job.deliveryFormats - Formats to deliver (google_docs, pdf, markdown, docx)
 * @param {Object} job.client - Client info
 * @param {string} job.client.email - Client email for Google Docs share
 * @param {boolean} job.shareWithClient - Whether to share Google Doc with client
 * @param {Object} context - Optional context
 * @returns {Promise<Object>} Delivery record with file locations
 */
async function delivery(job, context = {}) {
  const jobId = job.jobId || `delivery_${Date.now()}`;

  try {
    logger.info(`[delivery] Preparing content delivery for job ${jobId}`);

    const content = job.content || {};
    const formats = job.deliveryFormats || ['markdown'];
    const deliveryResults = [];
    const dataDir = path.join(process.cwd(), 'data', 'deliverables');

    // Normalize title once — never allow undefined/null/empty in filenames
    const safeTitle = (content.title || job.topic || job.title || 'Untitled')
      .replace(/[^a-zA-Z0-9_\-\s]/g, '')  // strip unsafe filename chars
      .replace(/\s+/g, '_')               // spaces → underscores
      .slice(0, 80)                        // cap length
      || 'Untitled';                       // final fallback if everything was stripped

    // Ensure delivery directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Generate markdown version (base format)
    if (formats.includes('markdown') || formats.length === 0) {
      const markdownFile = path.join(dataDir, `${jobId}_${safeTitle}.md`);

      const markdownContent = `# ${content.title || 'Untitled'}\n\n${content.body || ''}\n\n---\nDelivered: ${new Date().toISOString()}`;

      fs.writeFileSync(markdownFile, markdownContent);

      deliveryResults.push({
        format: 'markdown',
        filename: path.basename(markdownFile),
        path: markdownFile,
        size: markdownContent.length,
        url: `file://${markdownFile}`
      });

      logger.info(`[delivery] Markdown file generated: ${path.basename(markdownFile)}`);
    }

    // Generate Google Docs version
    if (formats.includes('google_docs')) {
      try {
        const driveService = serviceFactory.getService('drive');

        const googleDocResult = await driveService.createDocument({
          title: `${safeTitle.replace(/_/g, ' ')} - ${new Date().toLocaleDateString()}`,
          content: content.body || '',
          mimeType: 'application/vnd.google-apps.document'
        });

        // Share with client if requested
        if (job.shareWithClient && job.client?.email) {
          try {
            await driveService.shareDocument({
              fileId: googleDocResult.id,
              email: job.client.email,
              role: 'viewer'
            });

            logger.info(`[delivery] Google Doc shared with client: ${job.client.email}`);
          } catch (shareError) {
            logger.warn(`[delivery] Could not share Google Doc: ${shareError.message}`);
          }
        }

        deliveryResults.push({
          format: 'google_docs',
          documentId: googleDocResult.id,
          title: googleDocResult.title,
          url: googleDocResult.webViewLink || `https://docs.google.com/document/d/${googleDocResult.id}`,
          shared: job.shareWithClient
        });

        logger.info(`[delivery] Google Doc created: ${googleDocResult.id}`);
      } catch (driveError) {
        logger.warn(`[delivery] Google Docs creation failed: ${driveError.message}`);
        deliveryResults.push({
          format: 'google_docs',
          error: driveError.message,
          status: 'failed'
        });
      }
    }

    // DOCX generation — requires 'docx' package (not yet implemented)
    if (formats.includes('docx')) {
      deliveryResults.push({
        format: 'docx',
        status: 'unsupported',
        error: 'DOCX generation not implemented yet. Install "docx" package to enable.'
      });

      logger.warn(`[delivery] DOCX format requested but not yet implemented for job ${jobId}`);
    }

    // PDF generation — requires 'pdfkit' package (not yet implemented)
    if (formats.includes('pdf')) {
      deliveryResults.push({
        format: 'pdf',
        status: 'unsupported',
        error: 'PDF generation not implemented yet. Install "pdfkit" package to enable.'
      });

      logger.warn(`[delivery] PDF format requested but not yet implemented for job ${jobId}`);
    }

    // Get prompt manager for tracking
    const promptManager = getPromptManager();
    const prompt = promptManager.getPrompt('delivery');

    if (prompt) {
      promptManager.trackJobPromptVersion(jobId, 'delivery', prompt.version);
    }

    // Prepare delivery data
    const deliveryData = {
      id: jobId,
      contentTitle: content.title || 'Untitled',
      formatsRequested: formats,
      deliveryResults,
      clientEmail: job.client?.email,
      deliveredAt: new Date().toISOString(),
      status: 'delivered'
    };

    // Log activity
    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'delivery',
      jobId,
      action: 'content_delivered',
      contentTitle: content.title || 'Untitled',
      formats: formats.join(', '),
      fileCount: deliveryResults.length,
      status: 'completed'
    });

    logger.info(`[delivery] Content delivered for job ${jobId}: ${deliveryResults.length} files in ${formats.join(', ')} format(s)`);

    return deliveryData;
  } catch (error) {
    logger.error(`[delivery] Error delivering content for job ${jobId}:`, error);

    // Log failure
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
