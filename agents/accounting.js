/**
 * Accounting Agent
 * Tracks P&L, logs ledger entries, and performs cost analysis
 * Manages financial data for projects and overall business metrics
 */

const ApiClient = require('../utils/apiClient');
const { readData, writeData, appendToArray } = require('../utils/storage');
const { getPromptManager } = require('../utils/promptManager');
const logger = require('../utils/logger');

/**
 * Process accounting and financial tracking
 * @param {Object} job - Job object
 * @param {string} job.jobId - Unique job identifier
 * @param {string} job.type - Transaction type (revenue, expense, cost_analysis)
 * @param {number} job.amount - Amount in USD
 * @param {string} job.category - Expense/Revenue category
 * @param {string} job.description - Description
 * @param {Object} job.relatedJob - Related job reference
 * @param {Object} context - Optional context
 * @returns {Promise<Object>} Transaction/analysis object
 */
async function accounting(job, context = {}) {
  const jobId = job.jobId || `acct_${Date.now()}`;

  try {
    logger.info(`[accounting] Processing ${job.type} for job ${jobId}`);

    // Initialize API client
    const apiClient = new ApiClient();

    // Get prompt
    const promptManager = getPromptManager();
    const prompt = promptManager.getPrompt('accounting');

    if (!prompt) {
      throw new Error('Accounting prompt not found');
    }

    // Ensure ledger.json exists
    try {
      await readData('ledger.json');
    } catch {
      await writeData('ledger.json', []);
    }

    // For P&L analysis, generate insights
    let analysisResult = null;

    if (job.type === 'cost_analysis' || job.type === 'analysis') {
      const fullPrompt = `${prompt.content}

ANALYSIS REQUEST:
Period: ${job.period || 'Current Month'}
Focus: ${job.focus || 'Overall Business Performance'}

Context:
${job.context || 'General cost and profitability analysis'}

Provide analysis including:
1. Revenue summary
2. Cost breakdown by category
3. Profitability trends
4. Cost optimization opportunities
5. Risk areas
6. Recommendations for improvement`;

      analysisResult = await apiClient.generateJSON(
        fullPrompt,
        {
          type: 'object',
          properties: {
            period: { type: 'string' },
            totalRevenue: { type: 'number' },
            totalCosts: { type: 'number' },
            netProfit: { type: 'number' },
            profitMargin: { type: 'number' },
            costBreakdown: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  category: { type: 'string' },
                  amount: { type: 'number' },
                  percentage: { type: 'number' }
                }
              }
            },
            trends: {
              type: 'array',
              items: { type: 'string' }
            },
            opportunities: {
              type: 'array',
              items: { type: 'string' }
            },
            risks: {
              type: 'array',
              items: { type: 'string' }
            }
          }
        },
        {
          model: 'claude_haiku',
          maxTokens: 2048,
          temperature: 0.3,
          jobId,
          agentType: 'accounting'
        }
      );
    }

    // Create ledger entry
    const ledgerEntry = {
      id: jobId,
      timestamp: new Date().toISOString(),
      type: job.type,
      category: job.category || 'Uncategorized',
      amount: job.amount || 0,
      description: job.description || '',
      relatedJobId: job.relatedJob?.jobId,
      analysis: analysisResult?.content || null
    };

    // Append to ledger
    await appendToArray('ledger.json', ledgerEntry);

    // Prepare output
    const accountingData = {
      id: jobId,
      type: job.type,
      ledgerEntry,
      createdAt: new Date().toISOString(),
      usage: analysisResult?.usage || { inputTokens: 0, outputTokens: 0, cost: 0 }
    };

    // Track prompt version
    promptManager.trackJobPromptVersion(jobId, 'accounting', prompt.version);

    // Log activity
    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'accounting',
      jobId,
      action: `${job.type}_recorded`,
      type: job.type,
      amount: job.amount,
      category: job.category,
      status: 'completed'
    });

    logger.info(`[accounting] ${job.type} recorded for job ${jobId}: $${job.amount}`);

    return accountingData;
  } catch (error) {
    logger.error(`[accounting] Error processing accounting for job ${jobId}:`, error);

    // Log failure
    await appendToArray('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'accounting',
      jobId,
      action: 'accounting_failed',
      error: error.message,
      status: 'error'
    }).catch(() => {});

    throw error;
  }
}

module.exports = accounting;
