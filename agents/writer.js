/**
 * Writer Agent
 * Generates long-form content (800-2000 words)
 * Produces high-quality, SEO-optimized articles based on brief specifications
 */

const ApiClient = require('../utils/apiClient');
const { readData, writeData, appendToArray } = require('../utils/storage');
const { getPromptManager } = require('../utils/promptManager');
const logger = require('../utils/logger');

/**
 * Generate long-form content
 * @param {Object} job - Job object
 * @param {string} job.jobId - Unique job identifier
 * @param {Object} job.brief - Content brief/specifications
 * @param {string} job.topic - Main topic/title for the content
 * @param {number} job.wordCount - Target word count (800-2000)
 * @param {string} job.tone - Tone (professional, conversational, etc.)
 * @param {Array} job.keywords - Target SEO keywords
 * @param {Object} context - Optional context
 * @returns {Promise<Object>} Generated content object
 */
async function writer(job, context = {}) {
  const jobId = job.jobId || `writer_${Date.now()}`;

  try {
    logger.info(`[writer] Generating content for job ${jobId}`);

    // Initialize API client
    const apiClient = new ApiClient();

    // Get prompt
    const promptManager = getPromptManager();
    const prompt = promptManager.getPrompt('writer');

    if (!prompt) {
      throw new Error('Writer prompt not found');
    }

    // Calculate token allocation for larger content
    const wordCount = job.wordCount || 1200;
    const estimatedTokens = Math.ceil(wordCount / 3);
    const maxTokens = Math.min(estimatedTokens + 500, 4096);

    // Build comprehensive prompt
    const briefSummary = job.brief ? JSON.stringify(job.brief, null, 2) : 'No brief provided';
    const keywordString = job.keywords ? job.keywords.join(', ') : 'None specified';

    const fullPrompt = `${prompt.content}

CONTENT SPECIFICATIONS:
Title: ${job.topic || 'Untitled'}
Target Word Count: ${wordCount}
Tone: ${job.tone || 'Professional'}
Target Keywords: ${keywordString}

Brief Summary:
${briefSummary}

Requirements:
- Write exactly ${wordCount} words (±50 words acceptable)
- Naturally incorporate target keywords throughout
- Use clear structure with H2 headings
- Include an engaging introduction and strong conclusion
- Provide actionable insights and value to readers
- Maintain consistency with the tone specified`;

    // Generate content with Sonnet for higher quality
    const result = await apiClient.generateContent(
      fullPrompt,
      {
        model: 'claude_sonnet',
        maxTokens,
        temperature: 0.7,
        jobId,
        agentType: 'writer'
      }
    );

    // Extract content and estimate word count
    const content = result.content;
    const estimatedWords = content.split(/\s+/).length;

    // Prepare output
    const contentData = {
      id: jobId,
      title: job.topic || 'Untitled',
      content,
      wordCount: estimatedWords,
      targetWordCount: wordCount,
      tone: job.tone || 'Professional',
      keywords: job.keywords || [],
      createdAt: new Date().toISOString(),
      usage: result.usage
    };

    // Track prompt version
    promptManager.trackJobPromptVersion(jobId, 'writer', prompt.version);

    // Log activity
    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'writer',
      jobId,
      action: 'content_generated',
      title: job.topic,
      wordCount: estimatedWords,
      status: 'completed'
    });

    logger.info(`[writer] Content generated for job ${jobId}: ${estimatedWords} words`);

    return contentData;
  } catch (error) {
    logger.error(`[writer] Error generating content for job ${jobId}:`, error);

    // Log failure
    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'writer',
      jobId,
      action: 'content_generation_failed',
      error: error.message,
      status: 'error'
    }).catch(() => {});

    throw error;
  }
}

module.exports = writer;
