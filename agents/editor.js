/**
 * Editor Agent
 * Reviews content for quality, accuracy, tone, and SEO optimization
 * Returns detailed feedback and improvement suggestions
 */

const ApiClient = require('../utils/apiClient');
const { readData, writeData, appendToArray } = require('../utils/storage');
const { getPromptManager } = require('../utils/promptManager');
const logger = require('../utils/logger');

/**
 * Edit and review content
 * @param {Object} job - Job object
 * @param {string} job.jobId - Unique job identifier
 * @param {string} job.content - Content to edit
 * @param {string} job.tone - Expected tone
 * @param {Array} job.keywords - Target keywords
 * @param {Object} job.brief - Original brief for context
 * @param {Object} context - Optional context
 * @returns {Promise<Object>} Review and feedback object
 */
async function editor(job, context = {}) {
  const jobId = job.jobId || `editor_${Date.now()}`;

  try {
    logger.info(`[editor] Reviewing content for job ${jobId}`);

    // Initialize API client
    const apiClient = new ApiClient();

    // Get prompt
    const promptManager = getPromptManager();
    const prompt = promptManager.getPrompt('editor');

    if (!prompt) {
      throw new Error('Editor prompt not found');
    }

    const keywordString = job.keywords ? job.keywords.join(', ') : 'None specified';

    const fullPrompt = `${prompt.content}

REVIEW PARAMETERS:
Expected Tone: ${job.tone || 'Professional'}
Target Keywords: ${keywordString}
Word Count: ${job.content?.split(/\s+/).length || 0}

CONTENT TO REVIEW:
${job.content || 'No content provided'}

Please provide a comprehensive review covering:
1. Clarity and readability (rate 1-10)
2. Grammar and punctuation (rate 1-10)
3. Tone consistency (rate 1-10)
4. SEO optimization (rate 1-10)
5. Audience alignment (rate 1-10)
6. Specific issues found (list each issue with location)
7. Improvement suggestions (prioritized by impact)
8. SEO recommendations (keyword placement, meta opportunities)`;

    // Generate review
    const result = await apiClient.generateJSON(
      fullPrompt,
      {
        type: 'object',
        properties: {
          clarity: { type: 'number' },
          grammar: { type: 'number' },
          toneConsistency: { type: 'number' },
          seoScore: { type: 'number' },
          audienceAlignment: { type: 'number' },
          overallScore: { type: 'number' },
          issues: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                severity: { type: 'string' },
                location: { type: 'string' },
                description: { type: 'string' }
              }
            }
          },
          improvements: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                priority: { type: 'string' },
                suggestion: { type: 'string' },
                rationale: { type: 'string' }
              }
            }
          },
          seoRecommendations: {
            type: 'array',
            items: { type: 'string' }
          }
        }
      },
      {
        model: 'claude_sonnet',
        maxTokens: 3000,
        temperature: 0.3,
        jobId,
        agentType: 'editor'
      }
    );

    // Prepare review data
    const reviewData = {
      id: jobId,
      contentJobId: job.jobId,
      createdAt: new Date().toISOString(),
      review: result.content,
      scores: {
        clarity: result.content.clarity,
        grammar: result.content.grammar,
        toneConsistency: result.content.toneConsistency,
        seoScore: result.content.seoScore,
        audienceAlignment: result.content.audienceAlignment,
        overall: result.content.overallScore
      },
      issueCount: result.content.issues ? result.content.issues.length : 0,
      criticalIssues: result.content.issues ? result.content.issues.filter(i => i.severity === 'critical').length : 0,
      usage: result.usage
    };

    // Track prompt version
    promptManager.trackJobPromptVersion(jobId, 'editor', prompt.version);

    // Determine if content needs revision
    const needsRevision = result.content.overallScore < 75;

    // Log activity
    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'editor',
      jobId,
      action: 'review_completed',
      contentJobId: job.jobId,
      overallScore: result.content.overallScore,
      needsRevision,
      status: 'completed'
    });

    logger.info(`[editor] Review completed for job ${jobId}: score ${result.content.overallScore}/100`);

    return reviewData;
  } catch (error) {
    logger.error(`[editor] Error reviewing content for job ${jobId}:`, error);

    // Log failure
    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'editor',
      jobId,
      action: 'review_failed',
      error: error.message,
      status: 'error'
    }).catch(() => {});

    throw error;
  }
}

module.exports = editor;
