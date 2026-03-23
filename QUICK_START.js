/**
 * QUICK START - Phase 3 Revenue Engine
 * Example usage of all pipeline utilities
 */

const { Orchestrator, JOB_STATES } = require('./orchestrator');
const PipelineRunner = require('./utils/pipeline');
const ColdStartManager = require('./utils/coldStartManager');
const ScopeCreepDetector = require('./utils/scopeCreepDetector');
const DeadlineManager = require('./utils/deadlineManager');
const DynamicPricing = require('./utils/dynamicPricing');

// ============================================================================
// 1. INITIALIZE MODULES
// ============================================================================

const orchestrator = new Orchestrator(queues, config);
const apiClient = require('./utils/apiClient');

const pipeline = new PipelineRunner(orchestrator, apiClient, {
  qualityThreshold: 3,
  focusNiches: ['HR', 'PEO', 'benefits', 'compliance']
});

const coldStartManager = new ColdStartManager({
  reviewCountThreshold: 3,
  focusNiches: ['HR', 'PEO', 'benefits', 'compliance']
});

const scopeCreepDetector = new ScopeCreepDetector(apiClient);

const deadlineManager = new DeadlineManager({
  fiftyPercentThreshold: 0.5,
  twentyFivePercentThreshold: 0.25
});

const dynamicPricing = new DynamicPricing();

// ============================================================================
// 2. PROSPECT STAGE - Score and qualify opportunities
// ============================================================================

async function runProspectStage() {
  const opportunity = {
    id: 'opp_001',
    title: 'Write HR Policy Content',
    description: 'Need content for employee handbook',
    niche: 'HR',
    budget: { amount: 2500 },
    client: { name: 'TechCorp', rating: 4.8, reviews: 25 }
  };

  const result = await pipeline.processPROSPECT(opportunity);
  console.log('PROSPECT Result:', result);
  // Result includes: status, opportunityId, score, queuePosition

  // Check approval queue
  const queues = pipeline.getApprovalQueueStatus();
  console.log('Approval Queues:', queues);
}

// ============================================================================
// 3. GET PROSPECTING STRATEGY
// ============================================================================

function getProspectingStrategy() {
  const strategy = coldStartManager.getStrategyStatus();
  console.log('Current Strategy:', strategy.mode); // 'cold_outreach' or 'balanced'

  const dailyPlan = coldStartManager.getDailyActionPlan();
  console.log('Daily Actions:', dailyPlan.actions);

  const nextSteps = coldStartManager.getNextSteps();
  console.log('Next Steps:', nextSteps);

  // Log successful outcome
  coldStartManager.logOutcome('upwork_review', { projectId: 'job_123' });
}

// ============================================================================
// 4. PITCH STAGE - Generate and submit proposals
// ============================================================================

async function runPitchStage() {
  // Step 1: Process pitch (generates proposal)
  const pitchResult = await pipeline.processPITCH(approvalId);
  console.log('PITCH Result:', pitchResult);

  // Step 2: Owner approves and submits proposal
  const submitResult = await pipeline.submitProposal(proposalApprovalId);
  console.log('SUBMIT Result:', submitResult);
  // Returns jobId for production tracking
}

// ============================================================================
// 5. DYNAMIC PRICING - Calculate project price
// ============================================================================

function calculateProjectPrice() {
  const priceResult = dynamicPricing.calculatePrice({
    niche: 'HR',
    basePrice: 2000,
    customFactors: [1.15] // Rush fee
  });

  console.log('Tier:', priceResult.tier); // 'introductory', 'standard', or 'premium'
  console.log('Adjusted Price:', priceResult.adjusted_price);
  console.log('Recommendation:', priceResult.recommendation);

  // Get tiered options for client quote
  const options = dynamicPricing.getTieredPricingOptions({
    basePrice: 2000,
    niche: 'HR'
  });
  console.log('Pricing Options:', options);
}

// ============================================================================
// 6. PRODUCE STAGE - Generate, review, and approve content
// ============================================================================

async function runProduceStage() {
  const job = {
    id: 'job_001',
    state: JOB_STATES.BRIEFED,
    data: {
      clientName: 'TechCorp',
      proposalId: 'prop_001',
      requirements: 'HR policy content, 2000+ words'
    }
  };

  const produceResult = await pipeline.processPRODUCE(job);
  console.log('PRODUCE Result:', produceResult);
  // Includes: contentId, qualityScore, status

  // Get approval queue
  const queues = pipeline.getApprovalQueueStatus();
  console.log('Content Queue:', queues.content);
}

// ============================================================================
// 7. SCOPE CREEP DETECTION - Monitor for out-of-scope requests
// ============================================================================

async function detectScopeCreep() {
  const originalBrief = {
    id: 'brief_001',
    title: 'HR Content Project',
    budget: 2000,
    revisionRounds: 2,
    deliverables: ['Content', 'Revisions'],
    exclusions: ['Graphics', 'Video']
  };

  const revisionRequest = 'Can you add graphics and a design component?';

  const result = await scopeCreepDetector.analyzeRevisionRequest(
    originalBrief,
    revisionRequest
  );

  console.log('Is Scope Creep?', result.is_scope_creep);
  console.log('Confidence:', result.confidence);

  if (result.change_order) {
    console.log('Change Order Amount:', result.change_order.additionalCost);
    console.log('New Total Budget:', result.change_order.newTotalBudget);
  }
}

// ============================================================================
// 8. DEADLINE MANAGEMENT - Monitor and alert on deadlines
// ============================================================================

function manageDeadlines() {
  // Register a job for monitoring
  const job = {
    id: 'job_001',
    title: 'HR Content Project',
    clientName: 'TechCorp',
    deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    priority: 50
  };

  deadlineManager.registerJob(job);

  // Check all deadlines (run periodically)
  const results = deadlineManager.checkAllDeadlines();
  console.log('Alerts Triggered:', results.alertsTriggered.length);
  console.log('Communications Required:', results.communicationsRequired.length);

  // Get priority queue
  const queue = deadlineManager.getPriorityQueue();
  console.log('Jobs by Priority:', queue);

  // Get dashboard
  const dashboard = deadlineManager.getDashboardSummary();
  console.log('Dashboard:', dashboard);

  // When deadline checked, mark communication sent
  results.communicationsRequired.forEach(comm => {
    deadlineManager.markCommunicationSent(comm.id);
  });
}

// ============================================================================
// 9. DELIVER STAGE - Format, send, evaluate, and record
// ============================================================================

async function runDeliverStage() {
  const job = {
    id: 'job_001',
    data: {
      clientName: 'TechCorp',
      clientEmail: 'client@techcorp.com',
      proposalId: 'prop_001'
    }
  };

  const deliverResult = await pipeline.processDELIVER(contentApprovalId, job);
  console.log('DELIVER Result:', deliverResult);
  // Includes: revenue, profit, portfolioIncluded, status

  // Unregister from deadline manager when complete
  deadlineManager.unregisterJob(job.id, 'completed');
}

// ============================================================================
// 10. ANALYTICS & REPORTING
// ============================================================================

function getAnalytics() {
  // Pipeline metrics
  const pipelineMetrics = pipeline.getMetrics();
  console.log('Pipeline Metrics:', pipelineMetrics);

  // Cold start metrics
  const coldStartMetrics = coldStartManager.getMetrics();
  console.log('Cold Start Metrics:', coldStartMetrics);

  // Scope creep metrics
  const scopeCreepMetrics = scopeCreepDetector.getMetrics();
  console.log('Scope Creep Detection Rate:', scopeCreepMetrics.detectionRate);

  // Deadline metrics
  const deadlineMetrics = deadlineManager.getMetrics();
  console.log('Deadline Metrics:', deadlineMetrics);

  // Pricing analytics
  const pricingAnalytics = dynamicPricing.getAnalytics();
  console.log('Current Tier:', pricingAnalytics.currentTier);
  console.log('Average Price:', pricingAnalytics.averagePrice);
}

// ============================================================================
// 11. EXAMPLE: FULL PIPELINE FLOW
// ============================================================================

async function runFullPipeline() {
  console.log('='.repeat(80));
  console.log('STARTING FULL PIPELINE FLOW');
  console.log('='.repeat(80));

  try {
    // 1. Score opportunity
    console.log('\n--- PROSPECT STAGE ---');
    const prospectResult = await runProspectStage();

    // 2. Check prospecting strategy
    console.log('\n--- PROSPECTING STRATEGY ---');
    getProspectingStrategy();

    // 3. Calculate pricing
    console.log('\n--- PRICING CALCULATION ---');
    calculateProjectPrice();

    // 4. Generate proposal
    console.log('\n--- PITCH STAGE ---');
    const pitchResult = await runPitchStage();

    // 5. Register for deadline monitoring
    console.log('\n--- DEADLINE MANAGEMENT ---');
    manageDeadlines();

    // 6. Produce content
    console.log('\n--- PRODUCE STAGE ---');
    const produceResult = await runProduceStage();

    // 7. Check for scope creep on revisions
    console.log('\n--- SCOPE CREEP DETECTION ---');
    await detectScopeCreep();

    // 8. Deliver final product
    console.log('\n--- DELIVER STAGE ---');
    const deliverResult = await runDeliverStage();

    // 9. View analytics
    console.log('\n--- ANALYTICS ---');
    getAnalytics();

    console.log('\n' + '='.repeat(80));
    console.log('PIPELINE FLOW COMPLETE');
    console.log('='.repeat(80));
  } catch (error) {
    console.error('Pipeline Error:', error.message);
  }
}

// ============================================================================
// EXPORT FOR USE
// ============================================================================

module.exports = {
  pipeline,
  coldStartManager,
  scopeCreepDetector,
  deadlineManager,
  dynamicPricing,
  runFullPipeline,
  runProspectStage,
  runPitchStage,
  runProduceStage,
  runDeliverStage,
  manageDeadlines,
  detectScopeCreep,
  getAnalytics
};

// To run: node QUICK_START.js (after setting up orchestrator and queues)
