const storage = require('./storage');
const logger = require('./logger');
const { v4: uuidv4 } = require('uuid');

const MODEL_PRICING = {
  claude_sonnet: {
    name: 'Claude Sonnet',
    input_cost_per_1m: 3.0,
    output_cost_per_1m: 15.0
  },
  claude_haiku: {
    name: 'Claude Haiku',
    input_cost_per_1m: 0.80,
    output_cost_per_1m: 4.0
  },
  gpt_4: {
    name: 'GPT-4',
    input_cost_per_1m: 30.0,
    output_cost_per_1m: 60.0
  },
  gpt_3_5_turbo: {
    name: 'GPT-3.5 Turbo',
    input_cost_per_1m: 0.50,
    output_cost_per_1m: 1.50
  }
};

class TokenTracker {
  constructor() {
    this.sessionId = uuidv4();
    this.totalCost = 0;
    this.jobTrackers = {};
    this.bufferPercentage = 0.15;
  }

  /**
   * Initialize a job tracker. Idempotent — returns existing tracker if already initialized.
   */
  initializeJob(jobId, model = 'claude_haiku') {
    if (this.jobTrackers[jobId]) {
      return this.jobTrackers[jobId];
    }
    this.jobTrackers[jobId] = {
      jobId,
      model,
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      startTime: new Date()
    };
    return this.jobTrackers[jobId];
  }

  estimateTokens(text) {
    return Math.ceil((text?.length || 0) / 4);
  }

  trackJob(jobId, inputText, outputText, model = null) {
    if (!this.jobTrackers[jobId]) {
      this.initializeJob(jobId, model || 'claude_haiku');
    }

    const jobTracker = this.jobTrackers[jobId];
    const inputTokens = this.estimateTokens(inputText);
    const outputTokens = this.estimateTokens(outputText);

    jobTracker.inputTokens += inputTokens;
    jobTracker.outputTokens += outputTokens;
    jobTracker.cost = this.calculateJobCost(jobId);
    this.totalCost = this.calculateTotalCost();

    return {
      inputTokens,
      outputTokens,
      jobCost: jobTracker.cost,
      totalCost: this.totalCost
    };
  }

  calculateJobCost(jobId) {
    const job = this.jobTrackers[jobId];
    if (!job) return 0;

    const pricing = MODEL_PRICING[job.model];
    if (!pricing) {
      logger.warn(`Unknown model: ${job.model}`);
      return 0;
    }

    const inputTokens = Number(job.inputTokens) || 0;
    const outputTokens = Number(job.outputTokens) || 0;
    const inputCost = (inputTokens / 1_000_000) * (pricing.input_cost_per_1m || 0);
    const outputCost = (outputTokens / 1_000_000) * (pricing.output_cost_per_1m || 0);
    const subtotal = inputCost + outputCost;
    const result = subtotal * (1 + (this.bufferPercentage || 0));
    return isFinite(result) ? result : 0;
  }

  calculateTotalCost() {
    let total = 0;
    for (const jobId in this.jobTrackers) {
      total += this.jobTrackers[jobId].cost;
    }
    return total;
  }

  getSummary() {
    return {
      sessionId: this.sessionId,
      totalCost: this.totalCost,
      jobCount: Object.keys(this.jobTrackers).length
    };
  }

  getCostStatus(monthlyBudget = 500) {
    const percentageUsed = (this.totalCost / monthlyBudget) * 100;
    const remaining = monthlyBudget - this.totalCost;

    return {
      monthlyBudget,
      totalSpent: this.totalCost,
      remaining,
      percentageUsed,
      status: percentageUsed >= 95 ? 'critical' : (percentageUsed >= 80 ? 'warning' : 'healthy'),
      canContinue: percentageUsed < 100
    };
  }

  static estimateCost(inputText, outputText, model = 'claude_haiku') {
    const tracker = new TokenTracker();
    const inputTokens = tracker.estimateTokens(inputText);
    const outputTokens = tracker.estimateTokens(outputText);

    const pricing = MODEL_PRICING[model];
    if (!pricing) return 0;

    const inputCost = (inputTokens / 1_000_000) * pricing.input_cost_per_1m;
    const outputCost = (outputTokens / 1_000_000) * pricing.output_cost_per_1m;
    return (inputCost + outputCost) * 1.15;
  }
}

let globalTokenTracker = null;

function getTokenTracker() {
  if (!globalTokenTracker) {
    globalTokenTracker = new TokenTracker();
  }
  return globalTokenTracker;
}

function createNewTokenTracker() {
  globalTokenTracker = new TokenTracker();
  return globalTokenTracker;
}

// Export both as named and as default for compatibility with tests that do `new TokenTracker()`
module.exports = TokenTracker;
module.exports.TokenTracker = TokenTracker;
module.exports.getTokenTracker = getTokenTracker;
module.exports.createNewTokenTracker = createNewTokenTracker;
module.exports.MODEL_PRICING = MODEL_PRICING;
