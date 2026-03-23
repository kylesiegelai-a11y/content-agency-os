/**
 * Opportunity Scorer Agent
 * Scores opportunities 0-100 based on fit and profitability
 * Dynamically calculates pricing recommendations
 */

const ApiClient = require('../utils/apiClient');
const { readData, writeData, appendToArray } = require('../utils/storage');
const { getPromptManager } = require('../utils/promptManager');
const logger = require('../utils/logger');

/**
 * Score and analyze Upwork opportunities
 * @param {Object} job - Job object
 * @param {Array} job.opportunities - Opportunities to score
 * @param {Object} job.agencyProfile - Agency skills/rates
 * @param {string} job.agencyProfile.specialties - List of specialties
 * @param {number} job.agencyProfile.baseHourlyRate - Base hourly rate
 * @param {Object} context - Optional context
 * @returns {Promise<Object>} Scored opportunities with recommendations
 */
async function opportunityScorer(job, context = {}) {
  const jobId = job.jobId || `scorer_${Date.now()}`;

  try {
    logger.info(`[opportunityScorer] Scoring opportunities for job ${jobId}`);

    // Initialize API client
    const apiClient = new ApiClient();

    // Get prompt
    const promptManager = getPromptManager();
    const prompt = promptManager.getPrompt('opportunityScorer');

    if (!prompt) {
      throw new Error('Opportunity scorer prompt not found');
    }

    const opportunities = job.opportunities || [];
    const agencyProfile = job.agencyProfile || {
      specialties: 'content writing, SEO, blog posts',
      baseHourlyRate: 75,
      minProjectValue: 500
    };

    // Process each opportunity with scoring
    const scoredOpportunities = [];

    for (const opp of opportunities.slice(0, 20)) {
      const scoringPrompt = `${prompt.content}

OPPORTUNITY DETAILS:
Title: ${opp.title}
Budget: $${opp.budget}
Duration: ${opp.duration}
Experience Level Required: ${opp.level}
Work Type: ${opp.workType}
Description: ${opp.description}

AGENCY PROFILE:
Specialties: ${agencyProfile.specialties}
Base Rate: $${agencyProfile.baseHourlyRate}/hour
Minimum Project Value: $${agencyProfile.minProjectValue}

Evaluate this opportunity on:
1. Skill match (0-25 points)
2. Budget adequacy (0-25 points)
3. Project timeline feasibility (0-25 points)
4. Competition level (0-25 points)

Provide:
- Overall score (0-100)
- Break down by criteria
- Recommended bid price
- Likelihood of winning bid
- Risk factors`;

      const score = await apiClient.generateJSON(
        scoringPrompt,
        {
          type: 'object',
          properties: {
            opportunityId: { type: 'string' },
            title: { type: 'string' },
            skillMatch: { type: 'number' },
            budgetAdequacy: { type: 'number' },
            timelineFeasibility: { type: 'number' },
            competitionLevel: { type: 'number' },
            overallScore: { type: 'number' },
            recommendedBid: { type: 'number' },
            bidRange: {
              type: 'object',
              properties: {
                min: { type: 'number' },
                max: { type: 'number' }
              }
            },
            winningLikelihood: { type: 'string' },
            riskFactors: {
              type: 'array',
              items: { type: 'string' }
            },
            recommendation: { type: 'string' }
          }
        },
        {
          model: 'claude_haiku',
          maxTokens: 1500,
          temperature: 0.3,
          jobId: `${jobId}_${opp.id}`,
          agentType: 'scorer'
        }
      );

      scoredOpportunities.push({
        ...score.content,
        originalOpportunity: opp
      });
    }

    // Sort by score (highest first)
    scoredOpportunities.sort((a, b) => b.overallScore - a.overallScore);

    // Calculate portfolio statistics
    const avgScore = scoredOpportunities.length > 0
      ? scoredOpportunities.reduce((sum, o) => sum + o.overallScore, 0) / scoredOpportunities.length
      : 0;

    const topOpportunities = scoredOpportunities.filter(o => o.overallScore >= 75);
    const averageBidValue = topOpportunities.length > 0
      ? topOpportunities.reduce((sum, o) => sum + o.recommendedBid, 0) / topOpportunities.length
      : 0;

    // Prepare scoring results
    const scoringData = {
      id: jobId,
      opportunitiesAnalyzed: opportunities.length,
      scoredOpportunities,
      summary: {
        averageScore: avgScore,
        topOpportunitiesCount: topOpportunities.length,
        averageBidValue: Math.round(averageBidValue),
        potentialMonthlyRevenue: Math.round(averageBidValue * 4),
        agencySpecialties: agencyProfile.specialties
      },
      createdAt: new Date().toISOString(),
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cost: 0
      }
    };

    // Track prompt version
    promptManager.trackJobPromptVersion(jobId, 'opportunityScorer', prompt.version);

    // Log activity
    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'opportunityScorer',
      jobId,
      action: 'opportunities_scored',
      opportunitiesAnalyzed: opportunities.length,
      topOpportunities: topOpportunities.length,
      averageScore: Math.round(avgScore),
      status: 'completed'
    });

    logger.info(`[opportunityScorer] Scored ${scoredOpportunities.length} opportunities for job ${jobId}: avg score ${avgScore.toFixed(1)}`);

    return scoringData;
  } catch (error) {
    logger.error(`[opportunityScorer] Error scoring opportunities for job ${jobId}:`, error);

    // Log failure
    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'opportunityScorer',
      jobId,
      action: 'scoring_failed',
      error: error.message,
      status: 'error'
    }).catch(() => {});

    throw error;
  }
}

module.exports = opportunityScorer;
