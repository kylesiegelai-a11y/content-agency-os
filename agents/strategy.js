/**
 * Strategy Agent
 * Logs post-job outcomes to niches.json
 * Tracks niche expertise development and performance metrics
 */

const ApiClient = require('../utils/apiClient');
const { readData, writeData, appendToArray } = require('../utils/storage');
const { getPromptManager } = require('../utils/promptManager');
const logger = require('../utils/logger');

/**
 * Log job outcome and update niche strategy
 * @param {Object} job - Job object
 * @param {string} job.jobId - Unique job identifier
 * @param {string} job.niche - Industry/niche
 * @param {number} job.projectValue - Project value in USD
 * @param {number} job.qualityScore - Content quality score (0-100)
 * @param {string} job.clientFeedback - Client satisfaction feedback
 * @param {Array} job.metrics - Project metrics/results
 * @param {boolean} job.wonRepeatBusiness - Whether client wants more work
 * @param {Object} context - Optional context
 * @returns {Promise<Object>} Strategy update with niche insights
 */
async function strategy(job, context = {}) {
  const jobId = job.jobId || `strategy_${Date.now()}`;

  try {
    logger.info(`[strategy] Processing strategy update for job ${jobId}`);

    // Initialize API client
    const apiClient = new ApiClient();

    // Get prompt
    const promptManager = getPromptManager();
    const prompt = promptManager.getPrompt('strategy');

    if (!prompt) {
      throw new Error('Strategy prompt not found');
    }

    // Ensure niches.json exists
    let niches = [];
    try {
      niches = await readData('niches.json');
      if (!Array.isArray(niches)) {
        niches = [];
      }
    } catch {
      niches = [];
    }

    // Find or create niche entry
    const niche = job.niche || 'General';
    let nicheEntry = niches.find(n => n.name === niche);

    if (!nicheEntry) {
      nicheEntry = {
        name: niche,
        firstProjectDate: new Date().toISOString(),
        totalProjects: 0,
        totalRevenue: 0,
        avgQualityScore: 0,
        repeatBusinessCount: 0,
        successRate: 0,
        projects: []
      };
    }

    // Update niche metrics
    nicheEntry.totalProjects = (nicheEntry.totalProjects || 0) + 1;
    nicheEntry.totalRevenue = (nicheEntry.totalRevenue || 0) + (job.projectValue || 0);

    if (job.qualityScore !== undefined) {
      const previousTotal = (nicheEntry.avgQualityScore || 0) * (nicheEntry.totalProjects - 1 || 0);
      nicheEntry.avgQualityScore = (previousTotal + job.qualityScore) / nicheEntry.totalProjects;
    }

    if (job.wonRepeatBusiness) {
      nicheEntry.repeatBusinessCount = (nicheEntry.repeatBusinessCount || 0) + 1;
    }

    nicheEntry.successRate = nicheEntry.repeatBusinessCount / nicheEntry.totalProjects;

    // Add project record
    const projectRecord = {
      jobId,
      date: new Date().toISOString(),
      projectValue: job.projectValue,
      qualityScore: job.qualityScore,
      clientFeedback: job.clientFeedback,
      metrics: job.metrics,
      repeatBusiness: job.wonRepeatBusiness
    };

    nicheEntry.projects = nicheEntry.projects || [];
    nicheEntry.projects.push(projectRecord);

    // Update niche in array
    const index = niches.findIndex(n => n.name === niche);
    if (index >= 0) {
      niches[index] = nicheEntry;
    } else {
      niches.push(nicheEntry);
    }

    // Save updated niches
    await writeData('niches.json', niches);

    // Generate strategic insights
    const insightsPrompt = `${prompt.content}

NICHE PERFORMANCE DATA:
Name: ${niche}
Total Projects: ${nicheEntry.totalProjects}
Total Revenue: $${nicheEntry.totalRevenue}
Average Quality Score: ${nicheEntry.avgQualityScore.toFixed(1)}/100
Repeat Business Rate: ${(nicheEntry.successRate * 100).toFixed(1)}%

LATEST PROJECT:
Value: $${job.projectValue}
Quality: ${job.qualityScore}/100
Feedback: ${job.clientFeedback || 'Not provided'}
Repeat Business: ${job.wonRepeatBusiness ? 'Yes' : 'No'}

Provide strategic insights:
1. Current niche position and strength
2. Market opportunity assessment
3. Recommendations for growth
4. Suggested pricing adjustments
5. Content/service expansion opportunities
6. Risk factors to monitor`;

    const insights = await apiClient.generateJSON(
      insightsPrompt,
      {
        type: 'object',
        properties: {
          nichePosition: { type: 'string' },
          strengthLevel: { type: 'string' },
          marketOpportunity: { type: 'string' },
          recommendedActions: {
            type: 'array',
            items: { type: 'string' }
          },
          pricingRecommendation: { type: 'string' },
          expansionOpportunities: {
            type: 'array',
            items: { type: 'string' }
          },
          riskFactors: {
            type: 'array',
            items: { type: 'string' }
          },
          nextSteps: { type: 'string' }
        }
      },
      {
        model: 'claude_sonnet',
        maxTokens: 2000,
        temperature: 0.5,
        jobId,
        agentType: 'strategy'
      }
    );

    // Prepare strategy result
    const strategyData = {
      id: jobId,
      niche,
      nicheMetrics: {
        totalProjects: nicheEntry.totalProjects,
        totalRevenue: nicheEntry.totalRevenue,
        avgQualityScore: nicheEntry.avgQualityScore.toFixed(1),
        repeatBusinessRate: (nicheEntry.successRate * 100).toFixed(1) + '%'
      },
      latestProject: projectRecord,
      insights: insights.content,
      updatedAt: new Date().toISOString(),
      usage: insights.usage
    };

    // Track prompt version
    promptManager.trackJobPromptVersion(jobId, 'strategy', prompt.version);

    // Log activity
    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'strategy',
      jobId,
      action: 'strategy_update',
      niche,
      projectValue: job.projectValue,
      qualityScore: job.qualityScore,
      repeatBusiness: job.wonRepeatBusiness,
      status: 'completed'
    });

    logger.info(`[strategy] Strategy updated for niche '${niche}': ${nicheEntry.totalProjects} total projects, $${nicheEntry.totalRevenue} revenue`);

    return strategyData;
  } catch (error) {
    logger.error(`[strategy] Error updating strategy for job ${jobId}:`, error);

    // Log failure
    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'strategy',
      jobId,
      action: 'strategy_update_failed',
      error: error.message,
      status: 'error'
    }).catch(() => {});

    throw error;
  }
}

module.exports = strategy;
