/**
 * Client Brief Agent
 * Structures client requirements into a formal brief document
 * Accepts raw client input and generates a structured brief with specifications
 */

const ApiClient = require('../utils/apiClient');
const { readData, writeData, appendToArray } = require('../utils/storage');
const { getPromptManager } = require('../utils/promptManager');
const logger = require('../utils/logger');

/**
 * Process client requirements into formal brief
 * @param {Object} job - Job object
 * @param {string} job.jobId - Unique job identifier
 * @param {Object} job.client - Client information
 * @param {string} job.client.name - Client name
 * @param {string} job.client.email - Client email
 * @param {string} job.rawRequirements - Raw client input/requirements
 * @param {Object} context - Optional context
 * @returns {Promise<Object>} Brief object with structured data
 */
async function clientBrief(job, context = {}) {
  const jobId = job.jobId || `brief_${Date.now()}`;

  try {
    logger.info(`[clientBrief] Processing brief for job ${jobId}`);

    // Initialize API client
    const apiClient = new ApiClient();

    // Get prompt
    const promptManager = getPromptManager();
    const prompt = promptManager.getPrompt('clientBrief');

    if (!prompt) {
      throw new Error('Client brief prompt not found');
    }

    // Build prompt with client data
    const fullPrompt = `${prompt.content}

Client Name: ${job.client?.name || 'Unknown'}
Client Email: ${job.client?.email || 'N/A'}

Raw Requirements:
${job.rawRequirements || 'No requirements provided'}

Please structure these requirements into a formal brief with clear sections for:
1. Project Overview
2. Content Objectives
3. Target Audience
4. Key Topics/Areas to Cover
5. Tone and Style Requirements
6. Deliverables and Timeline
7. Success Metrics`;

    // Generate brief structure
    const result = await apiClient.generateJSON(
      fullPrompt,
      {
        type: 'object',
        properties: {
          projectTitle: { type: 'string' },
          overview: { type: 'string' },
          objectives: {
            type: 'array',
            items: { type: 'string' }
          },
          targetAudience: { type: 'string' },
          keyTopics: {
            type: 'array',
            items: { type: 'string' }
          },
          toneAndStyle: { type: 'string' },
          deliverables: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                wordCount: { type: 'number' },
                deadline: { type: 'string' }
              }
            }
          },
          successMetrics: {
            type: 'array',
            items: { type: 'string' }
          }
        }
      },
      {
        model: 'claude_haiku',
        maxTokens: 2048,
        jobId,
        agentType: 'brief'
      }
    );

    // Prepare brief object
    const briefData = {
      id: jobId,
      clientName: job.client?.name || 'Unknown',
      clientEmail: job.client?.email || '',
      createdAt: new Date().toISOString(),
      brief: result.content,
      rawRequirements: job.rawRequirements,
      usage: result.usage
    };

    // Track prompt version
    promptManager.trackJobPromptVersion(jobId, 'clientBrief', prompt.version);

    // Log activity
    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'clientBrief',
      jobId,
      action: 'brief_created',
      clientName: job.client?.name,
      status: 'completed'
    });

    logger.info(`[clientBrief] Brief generated successfully for job ${jobId}`);

    return briefData;
  } catch (error) {
    logger.error(`[clientBrief] Error processing brief for job ${jobId}:`, error);

    // Log failure
    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'clientBrief',
      jobId,
      action: 'brief_failed',
      error: error.message,
      status: 'error'
    }).catch(() => {});

    throw error;
  }
}

module.exports = clientBrief;
