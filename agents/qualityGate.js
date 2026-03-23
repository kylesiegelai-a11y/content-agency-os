/**
 * Quality Gate Agent
 * Scores content 0-100 on a rubric
 * Returns revision notes if below threshold (default 75)
 */

const ApiClient = require('../utils/apiClient');
const { readData, writeData, appendToArray } = require('../utils/storage');
const { getPromptManager } = require('../utils/promptManager');
const logger = require('../utils/logger');

/**
 * Perform quality assessment on content
 * @param {Object} job - Job object
 * @param {string} job.jobId - Unique job identifier
 * @param {string} job.content - Content to assess
 * @param {Object} job.rubric - Scoring rubric with criteria
 * @param {number} job.threshold - Minimum passing score (default 75)
 * @param {string} job.contentType - Type of content (article, proposal, etc.)
 * @param {Object} context - Optional context
 * @returns {Promise<Object>} Quality assessment object
 */
async function qualityGate(job, context = {}) {
  const jobId = job.jobId || `qgate_${Date.now()}`;
  const threshold = job.threshold || 75;

  try {
    logger.info(`[qualityGate] Assessing content quality for job ${jobId}`);

    // Initialize API client
    const apiClient = new ApiClient();

    // Get prompt
    const promptManager = getPromptManager();
    const prompt = promptManager.getPrompt('qualityGate');

    if (!prompt) {
      throw new Error('Quality gate prompt not found');
    }

    // Build rubric description
    const rubricDescription = job.rubric
      ? Object.entries(job.rubric).map(([criterion, weight]) => `${criterion} (${weight}%)`).join(', ')
      : 'Relevance (25%), Accuracy (25%), Engagement (25%), Grammar (25%)';

    const fullPrompt = `${prompt.content}

ASSESSMENT PARAMETERS:
Content Type: ${job.contentType || 'Article'}
Scoring Rubric: ${rubricDescription}
Pass Threshold: ${threshold}/100

CONTENT TO ASSESS:
${job.content || 'No content provided'}

Evaluate the content against the rubric and provide:
1. Individual criterion scores (0-100 for each)
2. Justification for each score
3. Overall score calculation
4. Pass/Fail determination based on ${threshold} threshold
5. If failing: Specific revision notes addressing each weak area
6. Priority of improvements (high/medium/low)

Format your response as structured JSON.`;

    // Generate assessment
    const result = await apiClient.generateJSON(
      fullPrompt,
      {
        type: 'object',
        properties: {
          contentType: { type: 'string' },
          assessmentDate: { type: 'string' },
          criteria: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                weight: { type: 'number' },
                score: { type: 'number' },
                justification: { type: 'string' }
              }
            }
          },
          overallScore: { type: 'number' },
          passed: { type: 'boolean' },
          threshold: { type: 'number' },
          revisionNotes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                area: { type: 'string' },
                issue: { type: 'string' },
                priority: { type: 'string' },
                recommendation: { type: 'string' }
              }
            }
          }
        }
      },
      {
        model: 'claude_sonnet',
        maxTokens: 3000,
        temperature: 0.3,
        jobId,
        agentType: 'qualityGate'
      }
    );

    // Extract assessment data with validation
    const assessment = result.content;
    if (!assessment || typeof assessment.overallScore !== 'number' || !isFinite(assessment.overallScore)) {
      logger.error('Quality gate received invalid score', { jobId, score: assessment?.overallScore });
      return {
        passed: false,
        overallScore: 0,
        error: 'Quality gate assessment returned invalid or missing score',
        assessment
      };
    }
    const passed = assessment.overallScore >= threshold;

    // Prepare quality gate data
    const gateData = {
      id: jobId,
      contentJobId: job.jobId,
      contentType: job.contentType || 'Article',
      overallScore: assessment.overallScore,
      threshold,
      passed,
      createdAt: new Date().toISOString(),
      assessment: assessment,
      usage: result.usage
    };

    // Track prompt version
    promptManager.trackJobPromptVersion(jobId, 'qualityGate', prompt.version);

    // Log activity
    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'qualityGate',
      jobId,
      action: 'quality_assessment',
      contentJobId: job.jobId,
      overallScore: assessment.overallScore,
      passed,
      threshold,
      status: 'completed'
    });

    logger.info(`[qualityGate] Assessment completed for job ${jobId}: ${assessment.overallScore}/100 (${passed ? 'PASSED' : 'FAILED'})`);

    return gateData;
  } catch (error) {
    logger.error(`[qualityGate] Error assessing content for job ${jobId}:`, error);

    // Log failure
    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'qualityGate',
      jobId,
      action: 'assessment_failed',
      error: error.message,
      status: 'error'
    }).catch(() => {});

    throw error;
  }
}

module.exports = qualityGate;
