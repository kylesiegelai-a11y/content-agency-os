/**
 * Client Communication Agent
 * Monitors inbox, responds to client messages, provides Calendly links
 * Manages ongoing communication during projects
 */

const ApiClient = require('../utils/apiClient');
const serviceFactory = require('../utils/serviceFactory');
const { readData, writeData, appendToArray } = require('../utils/storage');
const { getPromptManager } = require('../utils/promptManager');
const logger = require('../utils/logger');

/**
 * Monitor and manage client communication
 * @param {Object} job - Job object
 * @param {string} job.jobId - Unique job identifier
 * @param {string} job.action - Action to perform (check_inbox, draft_response, schedule_meeting)
 * @param {string} job.clientEmail - Client email address
 * @param {string} job.messageContent - Incoming message content (if responding)
 * @param {string} job.responseContext - Context for response (project status, etc.)
 * @param {string} job.calendlyLink - Calendly booking link
 * @param {Object} context - Optional context
 * @returns {Promise<Object>} Communication record
 */
async function clientCommunication(job, context = {}) {
  const jobId = job.jobId || `comm_${Date.now()}`;

  try {
    logger.info(`[clientCommunication] Processing ${job.action} for job ${jobId}`);

    // Initialize API client
    const apiClient = new ApiClient();

    // Get prompt
    const promptManager = getPromptManager();
    const prompt = promptManager.getPrompt('clientCommunication');

    if (!prompt) {
      throw new Error('Client communication prompt not found');
    }

    let communicationData = {
      id: jobId,
      action: job.action,
      clientEmail: job.clientEmail,
      createdAt: new Date().toISOString()
    };

    // Handle different communication actions
    if (job.action === 'draft_response') {
      // Generate response to client message
      const fullPrompt = `${prompt.content}

INCOMING MESSAGE FROM CLIENT:
${job.messageContent || 'No message provided'}

CONTEXT:
${job.responseContext || 'Ongoing project communication'}

Generate a professional, friendly response that:
1. Acknowledges their message and concerns
2. Provides clear, actionable information
3. Sets appropriate expectations
4. Offers next steps
5. Remains warm and professional
6. Is 150-250 words

Sign off with appropriate closing.`;

      const result = await apiClient.generateContent(
        fullPrompt,
        {
          model: 'claude_sonnet',
          maxTokens: 1024,
          temperature: 0.7,
          jobId,
          agentType: 'communication'
        }
      );

      communicationData = {
        ...communicationData,
        incomingMessage: job.messageContent,
        draftResponse: result.content,
        status: 'draft',
        usage: result.usage
      };

      logger.info(`[clientCommunication] Draft response generated for job ${jobId}`);
    }

    else if (job.action === 'schedule_meeting') {
      // Include Calendly link in communication
      const fullPrompt = `${prompt.content}

CLIENT EMAIL: ${job.clientEmail}

CONTEXT:
${job.responseContext || 'Scheduling meeting to discuss project'}

CALENDLY LINK: ${job.calendlyLink || 'https://calendly.com/kail'}

Generate a friendly message proposing a meeting that:
1. Suggests the meeting purpose
2. Explains why a sync would be valuable
3. Provides the Calendly link naturally
4. Gives flexibility in scheduling
5. Is warm and inviting
6. Is 100-150 words`;

      const result = await apiClient.generateContent(
        fullPrompt,
        {
          model: 'claude_haiku',
          maxTokens: 512,
          temperature: 0.7,
          jobId,
          agentType: 'communication'
        }
      );

      communicationData = {
        ...communicationData,
        meetingPurpose: job.responseContext,
        calendlyLink: job.calendlyLink,
        invitationMessage: result.content,
        status: 'ready_to_send',
        usage: result.usage
      };

      logger.info(`[clientCommunication] Meeting invitation generated for job ${jobId}`);
    }

    else if (job.action === 'check_inbox') {
      // Check for new messages
      try {
        const gmailService = serviceFactory.getService('gmail');
        const messages = await gmailService.getMessages({
          from: job.clientEmail,
          unread: true,
          limit: 10
        });

        communicationData = {
          ...communicationData,
          messagesFound: messages ? messages.length : 0,
          messages: messages || [],
          status: 'checked',
          usage: { inputTokens: 0, outputTokens: 0, cost: 0 }
        };

        logger.info(`[clientCommunication] Checked inbox for job ${jobId}: ${communicationData.messagesFound} unread messages`);
      } catch (error) {
        logger.warn(`[clientCommunication] Could not check Gmail: ${error.message}`);
        communicationData.error = error.message;
        communicationData.status = 'error';
      }
    }

    // Track prompt version
    promptManager.trackJobPromptVersion(jobId, 'clientCommunication', prompt.version);

    // Log activity
    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'clientCommunication',
      jobId,
      action: `communication_${job.action}`,
      clientEmail: job.clientEmail,
      status: 'completed'
    });

    return communicationData;
  } catch (error) {
    logger.error(`[clientCommunication] Error managing communication for job ${jobId}:`, error);

    // Log failure
    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'clientCommunication',
      jobId,
      action: 'communication_failed',
      error: error.message,
      status: 'error'
    }).catch(() => {});

    throw error;
  }
}

module.exports = clientCommunication;
