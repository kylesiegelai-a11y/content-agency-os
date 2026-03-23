/**
 * Cold Outreach Agent
 * Generates personalized cold emails and sends via Gmail service
 * Tracks opens, clicks, and follow-ups
 */

const ApiClient = require('../utils/apiClient');
const serviceFactory = require('../utils/serviceFactory');
const { readData, writeData, appendToArray } = require('../utils/storage');
const { getPromptManager } = require('../utils/promptManager');
const { preSendCheck, recordSend } = require('../utils/compliance');
const logger = require('../utils/logger');

/**
 * Generate and send cold outreach email
 * @param {Object} job - Job object
 * @param {string} job.jobId - Unique job identifier
 * @param {Object} job.recipient - Email recipient details
 * @param {string} job.recipient.email - Recipient email
 * @param {string} job.recipient.name - Recipient name
 * @param {string} job.recipient.company - Company name
 * @param {string} job.recipient.role - Job title
 * @param {Array} job.painPoints - Identified pain points
 * @param {string} job.service - Service being offered
 * @param {Object} job.agencyProfile - Agency info
 * @param {boolean} job.sendImmediately - Whether to send now or save as draft
 * @param {Object} context - Optional context
 * @returns {Promise<Object>} Outreach record
 */
async function coldOutreach(job, context = {}) {
  const jobId = job.jobId || job.id;
  if (!jobId || typeof jobId !== 'string') {
    throw new Error('Cold outreach requires a valid jobId');
  }

  try {
    logger.info(`[coldOutreach] Generating cold outreach for job ${jobId}`);

    // Initialize API client
    const apiClient = new ApiClient();

    // Get prompt
    const promptManager = getPromptManager();
    const prompt = promptManager.getPrompt('coldOutreach');

    if (!prompt) {
      throw new Error('Cold outreach prompt not found');
    }

    const recipient = job.recipient || {};
    const agencyProfile = job.agencyProfile || {
      name: 'KAIL Data Services',
      website: 'https://kail.dev',
      contact: 'hello@kail.dev'
    };

    // Generate personalized email
    const painPointsText = job.painPoints && job.painPoints.length > 0
      ? job.painPoints.join(', ')
      : 'content creation and marketing challenges';

    const fullPrompt = `${prompt.content}

RECIPIENT:
Name: ${recipient.name || 'Prospect'}
Email: ${recipient.email || 'prospect@company.com'}
Company: ${recipient.company || 'Company'}
Role: ${recipient.role || 'Decision Maker'}

IDENTIFIED PAIN POINTS:
${painPointsText}

SERVICE OFFERED:
${job.service || 'Professional content creation and marketing services'}

AGENCY INFO:
Name: ${agencyProfile.name}
Website: ${agencyProfile.website}
Contact: ${agencyProfile.contact}

Generate a compelling cold email that:
1. Opens with a personalized, specific observation
2. Addresses identified pain points directly
3. Briefly explains the solution without being pushy
4. Includes a social proof or relevant achievement
5. Has a clear, low-pressure CTA
6. Is concise (150-200 words)
7. Sounds genuine and human, not templated
8. Includes signature with contact info

Format the response as:
SUBJECT: [Subject line]

EMAIL:
[Email body with signature]`;

    // Generate email
    const result = await apiClient.generateContent(
      fullPrompt,
      {
        model: 'claude_sonnet',
        maxTokens: 1024,
        temperature: 0.7,
        jobId,
        agentType: 'outreach'
      }
    );

    // Parse email content
    const emailContent = result.content;
    const subjectMatch = emailContent.match(/SUBJECT:\s*(.+?)(?:\n|$)/);
    const emailMatch = emailContent.match(/EMAIL:\s*([\s\S]*)/);

    const subject = subjectMatch ? subjectMatch[1].trim() : 'Collaboration Opportunity';
    const body = emailMatch ? emailMatch[1].trim() : emailContent;

    // Prepare outreach record
    const outreachData = {
      id: jobId,
      recipientEmail: recipient.email,
      recipientName: recipient.name,
      company: recipient.company,
      role: recipient.role,
      subject,
      body,
      agencyName: agencyProfile.name,
      service: job.service,
      painPoints: job.painPoints || [],
      createdAt: new Date().toISOString(),
      status: 'draft',
      sendTime: null,
      usage: result.usage
    };

    // Compliance pre-send check (suppression list + rate limits)
    if (job.sendImmediately && recipient.email) {
      const complianceCheck = await preSendCheck(recipient.email);

      if (!complianceCheck.allowed) {
        outreachData.status = 'blocked';
        outreachData.complianceReason = complianceCheck.reason;
        outreachData.complianceCheck = complianceCheck.check;
        logger.warn(`[coldOutreach] Send blocked by compliance for job ${jobId}: ${complianceCheck.reason}`);
      } else {
        // Compliance passed — send email via Gmail service
        try {
          const gmailService = serviceFactory.getService('gmail');
          const sendResult = await gmailService.sendEmail({
            to: recipient.email,
            subject,
            body,
            isHtml: false
          });

          outreachData.status = 'sent';
          outreachData.sendTime = new Date().toISOString();
          outreachData.messageId = sendResult?.messageId;

          // Record the send for rate-limit tracking
          await recordSend(recipient.email);

          logger.info(`[coldOutreach] Email sent for job ${jobId} to ${recipient.email}`);
        } catch (emailError) {
          logger.warn(`[coldOutreach] Failed to send email: ${emailError.message}`);
          outreachData.sendError = emailError.message;
        }
      }
    }

    // Track prompt version
    promptManager.trackJobPromptVersion(jobId, 'coldOutreach', prompt.version);

    // Log activity
    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'coldOutreach',
      jobId,
      action: `outreach_${outreachData.status}`,
      recipientEmail: recipient.email,
      company: recipient.company,
      status: 'completed'
    });

    logger.info(`[coldOutreach] Outreach email generated for job ${jobId}: ${outreachData.status}`);

    return outreachData;
  } catch (error) {
    logger.error(`[coldOutreach] Error generating outreach for job ${jobId}:`, error);

    // Log failure
    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'coldOutreach',
      jobId,
      action: 'outreach_failed',
      error: error.message,
      status: 'error'
    }).catch(() => {});

    throw error;
  }
}

module.exports = coldOutreach;
