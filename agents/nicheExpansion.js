/**
 * Niche Expansion Agent
 * Monthly niche analysis and recommendations
 * Identifies opportunities for agency growth in new and existing niches
 */

const ApiClient = require('../utils/apiClient');
const { readData, writeData, appendToArray } = require('../utils/storage');
const { getPromptManager } = require('../utils/promptManager');
const logger = require('../utils/logger');

/**
 * Analyze niches and recommend expansion strategy
 * @param {Object} job - Job object
 * @param {string} job.jobId - Unique job identifier
 * @param {string} job.analysisMonth - Month to analyze (YYYY-MM, default: current)
 * @param {Array} job.targetNiches - New niches to evaluate
 * @param {Object} job.marketData - External market data
 * @param {Object} context - Optional context
 * @returns {Promise<Object>} Niche analysis and recommendations
 */
async function nicheExpansion(job, context = {}) {
  const jobId = job.jobId || `niche_${Date.now()}`;

  try {
    logger.info(`[nicheExpansion] Starting monthly niche expansion analysis for job ${jobId}`);

    // Initialize API client
    const apiClient = new ApiClient();

    // Get prompt
    const promptManager = getPromptManager();
    const prompt = promptManager.getPrompt('nicheExpansion');

    if (!prompt) {
      throw new Error('Niche expansion prompt not found');
    }

    // Read current niche data
    let niches = [];
    try {
      niches = await readData('niches.json');
      if (!Array.isArray(niches)) {
        niches = [];
      }
    } catch {
      niches = [];
    }

    // Prepare niche summary
    const nicheSummary = niches.map(n => ({
      name: n.name,
      projects: n.totalProjects,
      revenue: n.totalRevenue,
      quality: n.avgQualityScore,
      repeatRate: (n.successRate * 100).toFixed(1)
    }));

    // Analyze current performance
    const analysisMonth = job.analysisMonth || new Date().toISOString().substring(0, 7);

    const analysisPrompt = `${prompt.content}

CURRENT NICHE PORTFOLIO:
${JSON.stringify(nicheSummary, null, 2)}

ANALYSIS PERIOD: ${analysisMonth}

TARGET NICHES FOR EXPANSION:
${job.targetNiches?.join(', ') || 'SaaS, E-commerce, Healthcare, Education, Finance'}

MARKET CONTEXT:
${job.marketData ? JSON.stringify(job.marketData) : 'Based on industry trends'}

Provide comprehensive niche expansion analysis:
1. Performance analysis of current niches
2. Ranking of current niches by profitability and growth potential
3. Assessment of target niches for expansion
4. Market size and opportunity estimates for each target
5. Entry strategy for new niches
6. Recommended priority order for expansion
7. Resource allocation recommendations
8. 6-month growth projections
9. Risk assessment for each new niche
10. Action plan with timeline`;

    const analysis = await apiClient.generateJSON(
      analysisPrompt,
      {
        type: 'object',
        properties: {
          analysisMonth: { type: 'string' },
          currentNicheCount: { type: 'number' },
          topPerformingNiche: { type: 'string' },
          totalMonthlyRevenue: { type: 'number' },
          currentNicheRankings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                niche: { type: 'string' },
                rank: { type: 'number' },
                profitability: { type: 'string' },
                growthPotential: { type: 'string' }
              }
            }
          },
          targetNiches: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                marketSize: { type: 'string' },
                entryDifficulty: { type: 'string' },
                potentialRevenue: { type: 'string' },
                timeToProfitability: { type: 'string' },
                requiredSkills: {
                  type: 'array',
                  items: { type: 'string' }
                },
                entryStrategy: { type: 'string' }
              }
            }
          },
          expansionPriority: {
            type: 'array',
            items: { type: 'string' }
          },
          resourceAllocation: {
            type: 'object',
            properties: {
              currentNiches: { type: 'number' },
              newNiches: { type: 'number' },
              experimentation: { type: 'number' }
            }
          },
          sixMonthProjections: {
            type: 'object',
            properties: {
              totalProjects: { type: 'number' },
              estimatedRevenue: { type: 'number' },
              newNicheContribution: { type: 'string' }
            }
          },
          riskFactors: {
            type: 'array',
            items: { type: 'string' }
          },
          actionPlan: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                timeframe: { type: 'string' },
                action: { type: 'string' },
                targetNiches: {
                  type: 'array',
                  items: { type: 'string' }
                }
              }
            }
          }
        }
      },
      {
        model: 'claude_sonnet',
        maxTokens: 4096,
        temperature: 0.5,
        jobId,
        agentType: 'nicheExpansion'
      }
    );

    // Prepare expansion report
    const expansionReport = {
      id: jobId,
      analysisMonth,
      currentNichCount: niches.length,
      currentNiches: nicheSummary,
      analysis: analysis.content,
      generatedAt: new Date().toISOString(),
      nextAnalysisDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      usage: analysis.usage
    };

    // Save analysis report
    try {
      let reports = [];
      try {
        reports = await readData('niche_expansion_reports.json');
      } catch {
        reports = [];
      }

      reports.push({
        month: analysisMonth,
        report: analysis.content,
        createdAt: new Date().toISOString()
      });

      // Keep last 12 months
      if (reports.length > 12) {
        reports = reports.slice(-12);
      }

      await writeData('niche_expansion_reports.json', reports);
    } catch (saveError) {
      logger.warn(`[nicheExpansion] Could not save report: ${saveError.message}`);
    }

    // Track prompt version
    promptManager.trackJobPromptVersion(jobId, 'nicheExpansion', prompt.version);

    // Log activity
    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'nicheExpansion',
      jobId,
      action: 'monthly_analysis_completed',
      analysisMonth,
      currentNiches: niches.length,
      targetNiches: job.targetNiches?.length || 0,
      status: 'completed'
    });

    logger.info(`[nicheExpansion] Monthly niche analysis completed for job ${jobId}: ${niches.length} current niches, ${job.targetNiches?.length || 0} expansion targets`);

    return expansionReport;
  } catch (error) {
    logger.error(`[nicheExpansion] Error during niche expansion analysis for job ${jobId}:`, error);

    // Log failure
    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'nicheExpansion',
      jobId,
      action: 'analysis_failed',
      error: error.message,
      status: 'error'
    }).catch(() => {});

    throw error;
  }
}

module.exports = nicheExpansion;
