/**
 * Re-engagement Agent
 * Identifies past clients and generates follow-up campaigns
 * Targets previous customers for repeat business
 */

const ApiClient = require('../utils/apiClient');
const { readData, writeData, appendToArray } = require('../utils/storage');
const { getPromptManager } = require('../utils/promptManager');
const logger = require('../utils/logger');

/**
 * Generate re-engagement campaign for past clients
 * @param {Object} job - Job object
 * @param {string} job.jobId - Unique job identifier
 * @param {Array} job.pastClients - Array of past client objects
 * @param {Array} job.newServices - New services to promote
 * @param {string} job.campaignGoal - Campaign objective
 * @param {number} job.targetContactsLimit - Max contacts to target
 * @param {Object} context - Optional context
 * @returns {Promise<Object>} Re-engagement campaign with contacts and templates
 */
async function reEngagement(job, context = {}) {
  const jobId = job.jobId || `reeng_${Date.now()}`;

  try {
    logger.info(`[reEngagement] Creating re-engagement campaign for job ${jobId}`);

    // Initialize API client
    const apiClient = new ApiClient();

    // Get prompt
    const promptManager = getPromptManager();
    const prompt = promptManager.getPrompt('reEngagement');

    if (!prompt) {
      throw new Error('Re-engagement prompt not found');
    }

    const pastClients = job.pastClients || [];
    const newServices = job.newServices || [];
    const targetLimit = job.targetContactsLimit || 20;

    // Filter and prepare target clients
    const targetClients = pastClients.slice(0, targetLimit);

    // Generate campaign strategy
    const campaignPrompt = `${prompt.content}

PAST CLIENT BASE:
Total Clients: ${pastClients.length}
Targeting: ${targetClients.length} clients

TARGET CLIENTS:
${targetClients.map(c => `- ${c.name} (${c.company}) - Last project: ${c.lastProjectDate}`).join('\n')}

NEW SERVICES TO PROMOTE:
${newServices.join(', ')}

CAMPAIGN GOAL:
${job.campaignGoal || 'Reactivate past clients with new service offerings'}

Create a re-engagement campaign that includes:
1. Campaign strategy and timeline
2. Key messaging angles
3. Personalization opportunities
4. Email templates for different client segments
5. Success metrics and follow-up schedule
6. Expected conversion rates`;

    const strategy = await apiClient.generateJSON(
      campaignPrompt,
      {
        type: 'object',
        properties: {
          campaignName: { type: 'string' },
          targetCount: { type: 'number' },
          duration: { type: 'string' },
          messagingAngles: {
            type: 'array',
            items: { type: 'string' }
          },
          timeline: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                week: { type: 'number' },
                action: { type: 'string' },
                expected_engagement: { type: 'string' }
              }
            }
          },
          emailTemplate: { type: 'string' },
          success_metrics: {
            type: 'array',
            items: { type: 'string' }
          },
          expectedConversionRate: { type: 'string' }
        }
      },
      {
        model: 'claude_sonnet',
        maxTokens: 2500,
        temperature: 0.6,
        jobId,
        agentType: 'reengagement'
      }
    );

    // Generate personalized outreach for top 5 clients
    const personalizedOutreach = [];

    for (const client of targetClients.slice(0, 5)) {
      const personalPrompt = `Write a brief, personalized re-engagement email to ${client.name} at ${client.company}.

Their last project with us was: ${client.lastProjectDescription || 'A successful project'}
Date: ${client.lastProjectDate}

We now offer: ${newServices.join(', ')}

The email should:
- Reference their past project positively
- Explain why our new services would benefit them
- Be warm and conversational
- Include a soft CTA
- Be 150-200 words`;

      const personalEmail = await apiClient.generateContent(
        personalPrompt,
        {
          model: 'claude_haiku',
          maxTokens: 800,
          temperature: 0.7,
          jobId: `${jobId}_${client.id}`,
          agentType: 'reengagement'
        }
      );

      personalizedOutreach.push({
        clientName: client.name,
        clientEmail: client.email,
        personalized_email: personalEmail.content,
        lastProjectValue: client.projectValue,
        potentialUpsellOpportunity: calculateUpsellPotential(client, newServices)
      });
    }

    // Prepare campaign data
    const campaignData = {
      id: jobId,
      campaignName: strategy.content.campaignName,
      targetClientCount: targetClients.length,
      totalPastClients: pastClients.length,
      newServices,
      strategy: strategy.content,
      personalizedOutreach,
      projectedRevenue: calculateProjectedRevenue(personalizedOutreach),
      createdAt: new Date().toISOString(),
      status: 'draft',
      usage: strategy.usage
    };

    // Track prompt version
    promptManager.trackJobPromptVersion(jobId, 'reEngagement', prompt.version);

    // Log activity
    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'reEngagement',
      jobId,
      action: 'campaign_created',
      targetClientCount: targetClients.length,
      personalizedEmails: personalizedOutreach.length,
      status: 'completed'
    });

    logger.info(`[reEngagement] Campaign created for job ${jobId}: ${targetClients.length} targets, ${personalizedOutreach.length} personalized emails`);

    return campaignData;
  } catch (error) {
    logger.error(`[reEngagement] Error creating campaign for job ${jobId}:`, error);

    // Log failure
    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'reEngagement',
      jobId,
      action: 'campaign_failed',
      error: error.message,
      status: 'error'
    }).catch(() => {});

    throw error;
  }
}

/**
 * Calculate upsell potential based on past projects and new services
 */
function calculateUpsellPotential(client, newServices) {
  const baseValue = client.projectValue || 2000;
  const serviceCount = newServices.length;
  const multiplier = 1 + (serviceCount * 0.3);
  return Math.round(baseValue * multiplier);
}

/**
 * Calculate projected campaign revenue
 */
function calculateProjectedRevenue(personalizedOutreach) {
  if (personalizedOutreach.length === 0) return 0;

  const avgValue = personalizedOutreach.reduce((sum, item) => sum + item.potentialUpsellOpportunity, 0) / personalizedOutreach.length;
  const conversionRate = 0.3; // Assume 30% conversion for warm re-engagement
  return Math.round(avgValue * conversionRate * personalizedOutreach.length);
}

module.exports = reEngagement;
