/**
 * E2E Pipeline Tests
 * Priority 7: Happy-path — drives a job from DISCOVERED through DELIVERED via orchestrator.processJob()
 * Priority 8: Failure-path — verifies invalid agent output triggers validation + safe failure
 *
 * These tests call the real orchestrator with real agents in MOCK_MODE.
 * No synthetic data — every assertion checks actual orchestrator/agent behavior.
 */

const path = require('path');

// Force mock mode for all providers
process.env.MOCK_MODE = 'true';
process.env.NODE_ENV = 'test';

const { Orchestrator, JOB_STATES } = require('../../orchestrator');
const { initializeQueues } = require('../../utils/queueConfig');

describe('E2E Pipeline — Happy Path (Priority 7)', () => {
  let orchestrator;
  let queues;

  beforeAll(async () => {
    queues = await initializeQueues();
    orchestrator = new Orchestrator(queues, { maxRetries: 0 });
  });

  afterAll(async () => {
    try {
      if (queues) {
        for (const q of Object.values(queues)) {
          if (q && q.close) await q.close();
        }
      }
    } catch (e) { /* ignore cleanup errors */ }
  });

  test('Should drive a job from DISCOVERED to DELIVERED through all states', async () => {
    // Build a seed job with fields every agent in the pipeline needs
    const job = {
      id: `e2e-happy-${Date.now()}`,
      state: JOB_STATES.DISCOVERED,
      title: 'E2E Test Blog Post',
      description: 'Integration test content about cloud scaling',
      niche: 'technology',
      budget: { type: 'fixed', amount: 2000 },
      priority: 'medium',
      createdAt: new Date(),
      retryCount: 0,
      // opportunityScorer input
      opportunities: [
        {
          id: 'opp-1',
          title: 'Cloud Infrastructure Blog',
          description: 'Write about AWS scaling',
          budget: { amount: 2000 },
          skills: ['writing', 'technical'],
          deadline: '2026-04-15',
          clientRating: 4.5,
          clientReviews: 10,
          proposals: 5
        }
      ],
      agencyProfile: {
        specialties: 'technology, cloud, SaaS',
        baseHourlyRate: 75,
        minProjectValue: 500
      },
      // clientBrief input
      client: { name: 'TestCorp', email: 'test@example.com' },
      rawRequirements: 'Write a technical blog about cloud scaling best practices.',
      // writer input
      topic: 'Cloud Scaling Best Practices',
      wordCount: 1500,
      tone: 'professional',
      keywords: ['cloud', 'scaling', 'infrastructure'],
      // humanization input
      targetAudience: 'DevOps engineers',
      voiceProfile: 'technical but approachable',
      // qualityGate input
      rubric: {
        criteria: [
          { name: 'accuracy', weight: 0.3 },
          { name: 'clarity', weight: 0.3 },
          { name: 'engagement', weight: 0.2 },
          { name: 'seo', weight: 0.2 }
        ]
      },
      threshold: 70,
      contentType: 'blog_post',
      // content starts as a string; the orchestrator propagates writer output and
      // reshapes to { title, body } before the delivery agent runs
      content: 'Seed content — overwritten by writer agent',
      deliveryFormats: ['markdown'],
      shareWithClient: false
    };

    // The expected state progression
    const expectedStates = [
      'DISCOVERED',  // → qualifier → SCORED
      'SCORED',      // → qualifier → APPROVED
      'APPROVED',    // → briefer  → BRIEFED
      'BRIEFED',     // → writer   → WRITING  (note: NEXT_STATE maps BRIEFED → WRITING)
      'WRITING',     // → writer   → EDITING
      'EDITING',     // → editor   → HUMANIZING
      'HUMANIZING',  // → humanizer→ QUALITY_CHECK
      'QUALITY_CHECK',// → qa      → APPROVED_CONTENT
      'APPROVED_CONTENT', // → delivery → DELIVERING
      'DELIVERING'   // → delivery → DELIVERED (terminal)
    ];

    const visitedStates = [];
    const agentResults = {};

    for (const expectedState of expectedStates) {
      expect(job.state).toBe(expectedState);
      visitedStates.push(job.state);

      const result = await orchestrator.processJob({ data: job });

      // processJob should never return an error on the happy path
      expect(result).toBeDefined();
      expect(result.error).toBeFalsy();

      // Capture result keyed by state
      agentResults[expectedState] = result;
    }

    // After the loop, job should be in DELIVERED
    expect(job.state).toBe(JOB_STATES.DELIVERED);
    expect(job.completedAt).toBeDefined();
    expect(job.completionStatus).toBe('success');

    // Verify we visited every state
    expect(visitedStates).toEqual(expectedStates);

    // Spot-check key agent outputs

    // Qualifier (DISCOVERED) should return scored opportunities
    const qualifierResult = agentResults['DISCOVERED'];
    expect(qualifierResult.scoredOpportunities || qualifierResult.opportunitiesAnalyzed).toBeDefined();

    // Writer (BRIEFED or WRITING) should return content
    const writerResult = agentResults['BRIEFED'] || agentResults['WRITING'];
    expect(writerResult.content).toBeDefined();
    expect(writerResult.content.length).toBeGreaterThan(0);

    // Editor (EDITING) should return scores or review
    const editorResult = agentResults['EDITING'];
    expect(editorResult.scores || editorResult.review).toBeDefined();

    // Humanizer (HUMANIZING) should return humanizedContent
    const humanizerResult = agentResults['HUMANIZING'];
    expect(humanizerResult.humanizedContent || humanizerResult.content).toBeDefined();

    // QA (QUALITY_CHECK) should return a pass/fail
    const qaResult = agentResults['QUALITY_CHECK'];
    expect(qaResult.passed !== undefined || qaResult.assessment).toBeTruthy();

    // Delivery (DELIVERING) should return delivery results
    const deliveryResult = agentResults['DELIVERING'];
    expect(deliveryResult.deliveryResults || deliveryResult.status).toBeDefined();
  }, 30000); // 30s timeout — mock agents are fast but we're running 10 steps

  test('Job agentResults map should contain all agent names', async () => {
    // Re-run a quick mini pipeline to check agentResults accumulation
    const job = {
      id: `e2e-results-${Date.now()}`,
      state: JOB_STATES.DISCOVERED,
      opportunities: [{ id: 'o1', title: 'Test', description: 'Test', budget: { amount: 1000 }, skills: ['writing'], deadline: '2026-05-01', clientRating: 4.0, clientReviews: 5, proposals: 3 }],
      agencyProfile: { specialties: 'tech', baseHourlyRate: 50, minProjectValue: 200 },
      client: { name: 'Co', email: 'x@y.com' },
      rawRequirements: 'Test brief',
      topic: 'Test',
      wordCount: 800,
      tone: 'casual',
      keywords: ['test'],
      targetAudience: 'devs',
      voiceProfile: 'casual',
      rubric: { criteria: [{ name: 'quality', weight: 1.0 }] },
      threshold: 50,
      contentType: 'article',
      content: 'Test seed content',
      deliveryFormats: ['markdown'],
      shareWithClient: false,
      retryCount: 0,
      createdAt: new Date()
    };

    // Drive through first 3 states only
    await orchestrator.processJob({ data: job }); // DISCOVERED → SCORED
    await orchestrator.processJob({ data: job }); // SCORED → APPROVED
    await orchestrator.processJob({ data: job }); // APPROVED → BRIEFED

    expect(job.state).toBe(JOB_STATES.BRIEFED);
    expect(job.agentResults).toBeDefined();
    expect(job.agentResults.qualifier).toBeDefined();
    expect(job.agentResults.briefer).toBeDefined();
  }, 15000);
});


describe('E2E Pipeline — Failure Path (Priority 8)', () => {
  let orchestrator;
  let queues;

  beforeAll(async () => {
    queues = await initializeQueues();
    // maxRetries: 0 so failures go straight to dead letter
    orchestrator = new Orchestrator(queues, { maxRetries: 0 });
  });

  afterAll(async () => {
    try {
      if (queues) {
        for (const q of Object.values(queues)) {
          if (q && q.close) await q.close();
        }
      }
    } catch (e) { /* ignore */ }
  });

  test('Should reject agent output that fails validation (writer missing content)', async () => {
    // Monkey-patch the writer agent to return invalid output (no content field)
    const originalWriter = require('../../agents/writer');
    const AGENT_MODULES_ref = require('../../orchestrator').__test_internals?.AGENT_MODULES;

    // We can't easily patch AGENT_MODULES since it's module-scoped.
    // Instead, test the _validateAgentOutput method directly.
    const result = orchestrator._validateAgentOutput(JOB_STATES.WRITING, { summary: 'no content field' });
    expect(result).toBeTruthy();
    expect(result).toContain('content');
  });

  test('Should reject null agent output', () => {
    const result = orchestrator._validateAgentOutput(JOB_STATES.DISCOVERED, null);
    expect(result).toBeTruthy();
    expect(result).toContain('null');
  });

  test('Should reject agent output with error flag', () => {
    const result = orchestrator._validateAgentOutput(JOB_STATES.EDITING, { error: true, message: 'API timeout' });
    expect(result).toBeTruthy();
    expect(result).toContain('API timeout');
  });

  test('Should reject editor output missing required fields', () => {
    const result = orchestrator._validateAgentOutput(JOB_STATES.EDITING, { summary: 'looks good' });
    expect(result).toBeTruthy();
    expect(result).toContain('Editor');
  });

  test('Should reject humanizer output missing required fields', () => {
    const result = orchestrator._validateAgentOutput(JOB_STATES.HUMANIZING, { score: 85 });
    expect(result).toBeTruthy();
    expect(result).toContain('Humanizer');
  });

  test('Should reject briefer output missing brief', () => {
    const result = orchestrator._validateAgentOutput(JOB_STATES.APPROVED, { notes: 'incomplete' });
    expect(result).toBeTruthy();
    expect(result).toContain('brief');
  });

  test('Should accept valid qualifier output (flexible schema)', () => {
    const result = orchestrator._validateAgentOutput(JOB_STATES.DISCOVERED, { scoredOpportunities: [] });
    expect(result).toBeNull();
  });

  test('Should accept valid writer output', () => {
    const result = orchestrator._validateAgentOutput(JOB_STATES.WRITING, { content: 'Hello world' });
    expect(result).toBeNull();
  });

  test('Should accept valid editor output with scores', () => {
    const result = orchestrator._validateAgentOutput(JOB_STATES.EDITING, { scores: { overall: 90 } });
    expect(result).toBeNull();
  });

  test('Should accept QA output without explicit passed field (defaults to true)', () => {
    const qaResult = { assessment: { criteria: [] } };
    const result = orchestrator._validateAgentOutput(JOB_STATES.QUALITY_CHECK, qaResult);
    expect(result).toBeNull();
    // Should have been defaulted
    expect(qaResult.passed).toBe(true);
  });

  test('handleJobFailure should move job to dead letter when maxRetries=0', async () => {
    const job = {
      id: `e2e-fail-${Date.now()}`,
      state: JOB_STATES.WRITING,
      retryCount: 0
    };

    await orchestrator.handleJobFailure(job, new Error('Simulated failure'));

    // With maxRetries=0, job goes straight to dead letter
    expect(job.state).toBe(JOB_STATES.DEAD_LETTER);
    expect(job.failureReason).toBe('Simulated failure');

    // Should be in the dead letter queue
    const dlq = orchestrator.deadLetterQueue;
    const found = dlq.find(j => j.id === job.id);
    expect(found).toBeDefined();
  });

  test('processJob should handle agent that throws an exception', async () => {
    // Create an orchestrator with a patched agent that throws
    const throwingOrchestrator = new Orchestrator(queues, { maxRetries: 0 });

    // Override loadAgent to return a throwing function for 'qualifier'
    const originalLoadAgent = throwingOrchestrator.loadAgent.bind(throwingOrchestrator);
    throwingOrchestrator.loadAgent = async (name) => {
      if (name === 'qualifier') {
        return async () => { throw new Error('Mock agent explosion'); };
      }
      return originalLoadAgent(name);
    };

    const job = {
      id: `e2e-throw-${Date.now()}`,
      state: JOB_STATES.DISCOVERED,
      retryCount: 0,
      opportunities: [],
      agencyProfile: { specialties: 'test', baseHourlyRate: 50, minProjectValue: 100 }
    };

    const result = await throwingOrchestrator.processJob({ data: job });

    expect(result.error).toBe(true);
    expect(result.message).toContain('Mock agent explosion');
    // Job should be in dead letter (maxRetries=0)
    expect(job.state).toBe(JOB_STATES.DEAD_LETTER);
  });

  test('canTransitionTo should reject invalid transitions', () => {
    expect(orchestrator.canTransitionTo(JOB_STATES.DISCOVERED, JOB_STATES.DELIVERED)).toBe(false);
    expect(orchestrator.canTransitionTo(JOB_STATES.WRITING, JOB_STATES.DISCOVERED)).toBe(false);
    expect(orchestrator.canTransitionTo(JOB_STATES.DEAD_LETTER, JOB_STATES.WRITING)).toBe(false);
  });

  test('canTransitionTo should accept valid transitions', () => {
    expect(orchestrator.canTransitionTo(JOB_STATES.DISCOVERED, JOB_STATES.SCORED)).toBe(true);
    expect(orchestrator.canTransitionTo(JOB_STATES.WRITING, JOB_STATES.EDITING)).toBe(true);
    expect(orchestrator.canTransitionTo(JOB_STATES.DELIVERING, JOB_STATES.DELIVERED)).toBe(true);
    // Failure transitions should also be valid
    expect(orchestrator.canTransitionTo(JOB_STATES.WRITING, JOB_STATES.FAILED)).toBe(true);
  });
});
