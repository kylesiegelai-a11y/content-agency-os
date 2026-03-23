/**
 * Humanization Agent
 * Rewrites content to be more natural, personalized, and engaging
 * Removes robotic phrasing and adds conversational elements
 */

const ApiClient = require('../utils/apiClient');
const { readData, writeData, appendToArray } = require('../utils/storage');
const { getPromptManager } = require('../utils/promptManager');
const logger = require('../utils/logger');

/**
 * Humanize content for better engagement
 * @param {Object} job - Job object
 * @param {string} job.jobId - Unique job identifier
 * @param {string} job.content - Content to humanize
 * @param {string} job.targetAudience - Target audience description
 * @param {string} job.voiceProfile - Brand voice characteristics
 * @param {Object} context - Optional context
 * @returns {Promise<Object>} Humanized content object
 */
async function humanization(job, context = {}) {
  const jobId = job.jobId || `humanize_${Date.now()}`;

  try {
    logger.info(`[humanization] Humanizing content for job ${jobId}`);

    // Initialize API client
    const apiClient = new ApiClient();

    // Get prompt
    const promptManager = getPromptManager();
    const prompt = promptManager.getPrompt('humanization');

    if (!prompt) {
      throw new Error('Humanization prompt not found');
    }

    // Build prompt with contextual information
    const fullPrompt = `${prompt.content}

CONTEXT:
Target Audience: ${job.targetAudience || 'General audience'}
Voice Profile: ${job.voiceProfile || 'Professional yet approachable'}

ORIGINAL CONTENT:
${job.content || 'No content provided'}

Requirements:
- Make the writing sound natural and conversational
- Replace corporate jargon with plain language
- Add personal touches and relatable examples where appropriate
- Use contractions naturally (it's, doesn't, etc.)
- Include rhetorical questions to engage readers
- Maintain all factual accuracy and key information
- Keep the same structure but improve flow
- Add transitions that feel natural`;

    // Generate humanized version
    const result = await apiClient.generateContent(
      fullPrompt,
      {
        model: 'claude_sonnet',
        maxTokens: 4096,
        temperature: 0.8,
        jobId,
        agentType: 'humanization'
      }
    );

    // Calculate improvement metrics
    const originalContent = job.content || '';
    const humanizedContent = result.content;
    const originalWordCount = originalContent.split(/\s+/).length;
    const newWordCount = humanizedContent.split(/\s+/).length;
    const wordDifference = newWordCount - originalWordCount;

    // Prepare output
    const humanizedData = {
      id: jobId,
      originalContentId: job.jobId,
      originalContent,
      humanizedContent: humanizedContent,
      originalWordCount,
      newWordCount,
      wordCountChange: wordDifference,
      targetAudience: job.targetAudience || 'General',
      voiceProfile: job.voiceProfile || 'Professional',
      createdAt: new Date().toISOString(),
      usage: result.usage
    };

    // Track prompt version
    promptManager.trackJobPromptVersion(jobId, 'humanization', prompt.version);

    // Log activity
    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'humanization',
      jobId,
      action: 'content_humanized',
      originalContentId: job.jobId,
      wordCountChange: wordDifference,
      status: 'completed'
    });

    logger.info(`[humanization] Content humanized for job ${jobId}`);

    return humanizedData;
  } catch (error) {
    logger.error(`[humanization] Error humanizing content for job ${jobId}:`, error);

    // Log failure
    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'humanization',
      jobId,
      action: 'humanization_failed',
      error: error.message,
      status: 'error'
    }).catch(() => {});

    throw error;
  }
}

module.exports = humanization;
