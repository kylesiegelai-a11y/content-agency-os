/**
 * Portfolio Agent
 * Curates and selects high-quality content samples for portfolio
 * Manages portfolio metadata and presentation
 */

const ApiClient = require('../utils/apiClient');
const { readData, writeData, appendToArray } = require('../utils/storage');
const { getPromptManager } = require('../utils/promptManager');
const logger = require('../utils/logger');

/**
 * Evaluate and add content to portfolio
 * @param {Object} job - Job object
 * @param {string} job.jobId - Unique job identifier
 * @param {Object} job.content - Content piece to evaluate
 * @param {string} job.content.title - Content title
 * @param {string} job.content.body - Content body
 * @param {string} job.content.niche - Industry/niche
 * @param {string} job.clientName - Client name
 * @param {number} job.projectValue - Project value
 * @param {Array} job.results - Project results/metrics
 * @param {boolean} job.clientApprovalForShowcase - Client permission to showcase
 * @param {Object} context - Optional context
 * @returns {Promise<Object>} Portfolio entry or curation result
 */
async function portfolio(job, context = {}) {
  const jobId = job.jobId || `portfolio_${Date.now()}`;

  try {
    logger.info(`[portfolio] Evaluating content for portfolio for job ${jobId}`);

    // Initialize API client
    const apiClient = new ApiClient();

    // Get prompt
    const promptManager = getPromptManager();
    const prompt = promptManager.getPrompt('portfolio');

    if (!prompt) {
      throw new Error('Portfolio prompt not found');
    }

    const content = job.content || {};

    // Evaluate content for portfolio fit
    const evaluationPrompt = `${prompt.content}

CONTENT DETAILS:
Title: ${content.title || 'Untitled'}
Niche: ${job.content?.niche || 'General'}
Length: ${content.body?.split(/\s+/).length || 0} words
Client: ${job.clientName || 'Confidential'}

CONTENT EXCERPT:
${content.body ? content.body.substring(0, 500) + '...' : 'No content provided'}

PROJECT METRICS:
Value: $${job.projectValue || 'N/A'}
Results: ${job.results?.join(', ') || 'Not specified'}
Client Approval for Showcase: ${job.clientApprovalForShowcase ? 'Yes' : 'No'}

Evaluate this content for portfolio inclusion:
1. Quality assessment (1-10)
2. Relevance to target clients
3. Niche/industry applicability
4. Unique value demonstration
5. Client success story potential
6. Recommendation (include/conditional/exclude)
7. If including, suggest portfolio description

Provide JSON response.`;

    const evaluation = await apiClient.generateJSON(
      evaluationPrompt,
      {
        type: 'object',
        properties: {
          qualityScore: { type: 'number' },
          relevanceScore: { type: 'number' },
          nicheApplicability: { type: 'string' },
          uniqueValuePoints: {
            type: 'array',
            items: { type: 'string' }
          },
          successStoryPotential: { type: 'string' },
          recommendation: { type: 'string' },
          portfolioDescription: { type: 'string' },
          suggestedTags: {
            type: 'array',
            items: { type: 'string' }
          }
        }
      },
      {
        model: 'claude_sonnet',
        maxTokens: 2000,
        temperature: 0.3,
        jobId,
        agentType: 'portfolio'
      }
    );

    // Prepare portfolio entry if recommended
    let portfolioEntry = null;

    if (evaluation.content.recommendation === 'include' || evaluation.content.recommendation?.toLowerCase().includes('include')) {
      portfolioEntry = {
        id: jobId,
        title: content.title || 'Untitled',
        contentPreview: content.body ? content.body.substring(0, 300) + '...' : '',
        fullContent: content.body || '',
        niche: job.content?.niche || 'General',
        clientName: job.clientApprovalForShowcase ? job.clientName : 'Confidential Client',
        projectValue: job.projectValue,
        results: job.results || [],
        qualityScore: evaluation.content.qualityScore,
        relevanceScore: evaluation.content.relevanceScore,
        portfolioDescription: evaluation.content.portfolioDescription,
        tags: evaluation.content.suggestedTags || [],
        addedAt: new Date().toISOString(),
        featured: evaluation.content.qualityScore >= 8
      };
    }

    // Read existing portfolio
    let portfolioData = [];
    try {
      portfolioData = await readData('portfolio.json');
    } catch {
      portfolioData = [];
    }

    // Add entry if recommended and approved
    if (portfolioEntry && (evaluation.content.recommendation === 'include' || !job.clientApprovalForShowcase || (job.clientApprovalForShowcase && evaluation.content.recommendation?.includes('include')))) {
      portfolioData.push(portfolioEntry);

      // Update portfolio file
      await writeData('portfolio.json', portfolioData);

      logger.info(`[portfolio] Content added to portfolio: ${content.title}`);
    }

    // Prepare result
    const portfolioResult = {
      id: jobId,
      contentTitle: content.title,
      evaluation: evaluation.content,
      portfolioEntry,
      portfolioStatus: portfolioEntry ? 'added' : 'not_included',
      totalPortfolioSize: portfolioData.length,
      createdAt: new Date().toISOString(),
      usage: evaluation.usage
    };

    // Track prompt version
    promptManager.trackJobPromptVersion(jobId, 'portfolio', prompt.version);

    // Log activity
    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'portfolio',
      jobId,
      action: `portfolio_${portfolioResult.portfolioStatus}`,
      contentTitle: content.title,
      niche: job.content?.niche,
      status: 'completed'
    });

    logger.info(`[portfolio] Portfolio evaluation completed for job ${jobId}: ${portfolioResult.portfolioStatus}`);

    return portfolioResult;
  } catch (error) {
    logger.error(`[portfolio] Error evaluating portfolio content for job ${jobId}:`, error);

    // Log failure
    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'portfolio',
      jobId,
      action: 'portfolio_evaluation_failed',
      error: error.message,
      status: 'error'
    }).catch(() => {});

    throw error;
  }
}

module.exports = portfolio;
