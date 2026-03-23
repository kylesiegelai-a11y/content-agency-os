/**
 * Proposal Writer Agent
 * Writes compelling Upwork proposals with KAIL branding
 * Customizes proposals based on opportunity details and agency strengths
 */

const ApiClient = require('../utils/apiClient');
const { readData, writeData, appendToArray } = require('../utils/storage');
const { getPromptManager } = require('../utils/promptManager');
const logger = require('../utils/logger');

/**
 * Generate customized Upwork proposal
 * @param {Object} job - Job object
 * @param {Object} job.opportunity - Target opportunity details
 * @param {string} job.opportunity.id - Opportunity ID
 * @param {string} job.opportunity.title - Opportunity title
 * @param {string} job.opportunity.description - Job description
 * @param {number} job.opportunity.budget - Budget
 * @param {Object} job.agencyProfile - Agency details
 * @param {string} job.agencyProfile.name - Agency name (KAIL)
 * @param {string} job.agencyProfile.description - Agency description
 * @param {Array} job.agencyProfile.portfolio - Portfolio samples
 * @param {number} job.proposedBid - Proposed bid amount
 * @param {Object} context - Optional context
 * @returns {Promise<Object>} Generated proposal
 */
async function proposalWriter(job, context = {}) {
  const jobId = job.jobId || `proposal_${Date.now()}`;

  try {
    logger.info(`[proposalWriter] Generating proposal for job ${jobId}`);

    // Initialize API client
    const apiClient = new ApiClient();

    // Get prompt
    const promptManager = getPromptManager();
    const prompt = promptManager.getPrompt('proposalWriter');

    if (!prompt) {
      throw new Error('Proposal writer prompt not found');
    }

    const opportunity = job.opportunity || {};
    const agencyProfile = job.agencyProfile || {
      name: 'KAIL Data Services',
      description: 'Content Creation & Marketing Agency',
      portfolio: []
    };

    // Build comprehensive prompt for proposal
    const portfolioSummary = agencyProfile.portfolio && agencyProfile.portfolio.length > 0
      ? agencyProfile.portfolio.map(p => `- ${p.title} (${p.niche})`).join('\n')
      : 'Award-winning content for SaaS, B2B, and service-based companies';

    const fullPrompt = `${prompt.content}

CLIENT OPPORTUNITY:
Title: ${opportunity.title || 'Content Project'}
Budget: $${opportunity.budget || 'TBD'}
Duration: ${opportunity.duration || 'TBD'}
Experience Level: ${opportunity.level || 'Intermediate'}
Description: ${opportunity.description || 'Content creation project'}

AGENCY PROFILE:
Name: ${agencyProfile.name}
Description: ${agencyProfile.description}
Specialties: ${agencyProfile.specialties || 'Content writing, SEO, Blog posts'}

PORTFOLIO HIGHLIGHTS:
${portfolioSummary}

PROPOSED BID: $${job.proposedBid || opportunity.budget || 1000}

Generate a compelling Upwork proposal that:
1. Opens with a strong attention-grabbing intro
2. Demonstrates understanding of their specific needs
3. Highlights relevant experience and past successes
4. Showcases why KAIL is the perfect fit
5. Clearly outlines deliverables and timeline
6. Includes a strong closing with call to action
7. Maintains professional yet personable tone
8. Approximately 300-400 words`;

    // Generate proposal
    const result = await apiClient.generateContent(
      fullPrompt,
      {
        model: 'claude_sonnet',
        maxTokens: 2048,
        temperature: 0.7,
        jobId,
        agentType: 'proposal'
      }
    );

    const proposal = result.content;
    const wordCount = proposal.split(/\s+/).length;

    // Prepare proposal data
    const proposalData = {
      id: jobId,
      opportunityId: opportunity.id,
      opportunityTitle: opportunity.title,
      proposal,
      wordCount,
      proposedBid: job.proposedBid,
      budgetVsProposal: job.proposedBid ? (opportunity.budget ? ((job.proposedBid / opportunity.budget) * 100).toFixed(0) + '%' : 'N/A') : 'N/A',
      agencyName: agencyProfile.name,
      createdAt: new Date().toISOString(),
      status: 'draft',
      usage: result.usage
    };

    // Track prompt version
    promptManager.trackJobPromptVersion(jobId, 'proposalWriter', prompt.version);

    // Log activity
    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'proposalWriter',
      jobId,
      action: 'proposal_generated',
      opportunityId: opportunity.id,
      opportunityTitle: opportunity.title,
      proposedBid: job.proposedBid,
      status: 'completed'
    });

    logger.info(`[proposalWriter] Proposal generated for job ${jobId}: ${wordCount} words`);

    return proposalData;
  } catch (error) {
    logger.error(`[proposalWriter] Error generating proposal for job ${jobId}:`, error);

    // Log failure
    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'proposalWriter',
      jobId,
      action: 'proposal_generation_failed',
      error: error.message,
      status: 'error'
    }).catch(() => {});

    throw error;
  }
}

module.exports = proposalWriter;
