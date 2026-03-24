/**
 * Research Agent
 * Analyzes opportunities that have already been ingested by the acquisition engine.
 *
 * IMPORTANT: This agent does NOT fetch opportunities itself. All opportunity
 * ingestion goes through the acquisition engine (acquisition/acquisitionEngine.js).
 * This agent receives already-ingested opportunities and uses Claude to produce
 * strategic analysis: top matches, effort estimates, earnings potential, and
 * bidding strategy.
 *
 * Production safety: zero opportunities means zero opportunities — no fabrication.
 */

const ApiClient = require('../utils/apiClient');
const { readData, writeData, appendToArray } = require('../utils/storage');
const { getPromptManager } = require('../utils/promptManager');
const logger = require('../utils/logger');

/**
 * Analyze and rank opportunities for strategic fit.
 * Opportunities must be provided in job.opportunities (sourced from the acquisition engine).
 *
 * @param {Object} job - Job object
 * @param {Array} job.opportunities - Pre-fetched opportunities from the acquisition engine
 * @param {Array} job.niches - Target niches/specialties (for analysis context)
 * @param {Array} job.keywords - Search keywords (for analysis context)
 * @param {number} job.maxResults - Max results to analyze (default 20)
 * @param {Object} context - Optional context
 * @returns {Promise<Object>} Analysis results with ranked opportunities
 */
async function research(job, context = {}) {
  const jobId = job.jobId || `research_${Date.now()}`;

  try {
    logger.info(`[research] Starting opportunity analysis for job ${jobId}`);

    // Get prompt
    const promptManager = getPromptManager();
    const prompt = promptManager.getPrompt('research');

    if (!prompt) {
      throw new Error('Research prompt not found');
    }

    // Opportunities must come from the acquisition engine — not fetched here.
    // If the caller hasn't provided them, report zero honestly.
    let opportunities = job.opportunities || [];

    if (!Array.isArray(opportunities)) {
      logger.warn(`[research] job.opportunities is not an array — treating as empty`);
      opportunities = [];
    }

    // Trim to maxResults
    const maxResults = job.maxResults || 20;
    opportunities = opportunities.slice(0, maxResults);

    if (opportunities.length === 0) {
      logger.info(`[research] No opportunities provided for analysis — reporting zero results honestly`);
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
      action: 'opportunities_analyzed',
      opportunityCount: opportunities.length,
      niches: job.niches,
      status: 'completed'
    });

    logger.info(`[research] Analysis completed for job ${jobId}: ${opportunities.length} opportunities analyzed`);

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
