/**
 * Research Agent
 * Discovers opportunities based on agency skills/niches.
 * Uses the acquisition engine when available, falls back to direct service calls.
 * NOTE: In production mode, zero opportunities means zero opportunities.
 * Sample/demo data is never fabricated outside explicit mock mode.
 */

const ApiClient = require('../utils/apiClient');
const serviceFactory = require('../utils/serviceFactory');
const { readData, writeData, appendToArray } = require('../utils/storage');
const { getPromptManager } = require('../utils/promptManager');
const logger = require('../utils/logger');

/**
 * Research and discover Upwork opportunities
 * @param {Object} job - Job object
 * @param {Array} job.niches - Target niches/specialties
 * @param {Array} job.keywords - Search keywords
 * @param {Object} job.filters - Additional filters (budget, experience_level, etc.)
 * @param {number} job.maxResults - Max results to return (default 20)
 * @param {Object} context - Optional context
 * @returns {Promise<Object>} Opportunities list with details
 */
async function research(job, context = {}) {
  const jobId = job.jobId || `research_${Date.now()}`;

  try {
    logger.info(`[research] Starting opportunity research for job ${jobId}`);

    // Get Upwork service
    const upworkService = serviceFactory.getService('upwork');

    // Get prompt
    const promptManager = getPromptManager();
    const prompt = promptManager.getPrompt('research');

    if (!prompt) {
      throw new Error('Research prompt not found');
    }

    // Build search parameters
    const searchParams = {
      niches: job.niches || ['content writing', 'article writing', 'blog writing'],
      keywords: job.keywords || ['content', 'article', 'writing'],
      filters: job.filters || {},
      limit: job.maxResults || 20
    };

    // Search for opportunities on Upwork
    let opportunities = [];
    let rawResults = null;

    try {
      // Call mock/real Upwork service
      rawResults = await upworkService.searchOpportunities(searchParams);
      opportunities = rawResults || [];
    } catch (error) {
      logger.warn(`[research] Upwork service error: ${error.message}`);
      opportunities = [];
    }

    // PRODUCTION SAFETY: Never fabricate opportunities.
    // In mock mode, the mock service already returns test data.
    // In production, zero results means zero results — reported honestly.
    if (!opportunities || opportunities.length === 0) {
      const MOCK_MODE = process.env.MOCK_MODE === 'true' || process.env.MOCK_MODE === '1';
      if (MOCK_MODE) {
        logger.info(`[research] No opportunities found in mock mode — mock service may be empty`);
      } else {
        logger.info(`[research] No opportunities found from source — reporting zero results honestly`);
      }
      opportunities = [];
    }

    // Use Claude to analyze and rank opportunities
    const apiClient = new ApiClient();

    const analysisPrompt = `${prompt.content}

SEARCH PARAMETERS:
Niches: ${job.niches?.join(', ') || 'content writing'}
Keywords: ${job.keywords?.join(', ') || 'content, writing'}

DISCOVERED OPPORTUNITIES (${opportunities.length} found):
${JSON.stringify(opportunities.slice(0, 10), null, 2)}

Analyze these opportunities and provide:
1. Top 5 best matches with explanations
2. Estimated effort/timeline for each
3. Potential earnings range
4. Risk assessment
5. Recommended bidding strategy`;

    const analysis = await apiClient.generateJSON(
      analysisPrompt,
      {
        type: 'object',
        properties: {
          topMatches: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                opportunityId: { type: 'string' },
                rank: { type: 'number' },
                title: { type: 'string' },
                matchScore: { type: 'number' },
                estimatedEffort: { type: 'string' },
                potentialEarnings: { type: 'string' },
                riskLevel: { type: 'string' },
                biddingStrategy: { type: 'string' }
              }
            }
          },
          summary: { type: 'string' }
        }
      },
      {
        model: 'claude_haiku',
        maxTokens: 2048,
        temperature: 0.5,
        jobId,
        agentType: 'researcher'
      }
    );

    // Prepare research data
    const researchData = {
      id: jobId,
      niches: job.niches || [],
      keywords: job.keywords || [],
      totalOpportunitiesFound: opportunities.length,
      opportunities,
      analysis: analysis.content,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
      usage: analysis.usage
    };

    // Track prompt version
    promptManager.trackJobPromptVersion(jobId, 'research', prompt.version);

    // Log activity
    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'research',
      jobId,
      action: 'opportunities_discovered',
      opportunityCount: opportunities.length,
      niches: job.niches,
      status: 'completed'
    });

    logger.info(`[research] Research completed for job ${jobId}: ${opportunities.length} opportunities found`);

    return researchData;
  } catch (error) {
    logger.error(`[research] Error during research for job ${jobId}:`, error);

    // Log failure
    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'research',
      jobId,
      action: 'research_failed',
      error: error.message,
      status: 'error'
    }).catch(() => {});

    throw error;
  }
}

module.exports = research;
