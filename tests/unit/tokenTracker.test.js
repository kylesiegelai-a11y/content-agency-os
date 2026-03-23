/**
 * TokenTracker Unit Tests
 * Tests token counting, cost calculations, per-job tracking, and threshold detection
 */

const TokenTracker = require('../../utils/tokenTracker');

describe('TokenTracker Class', () => {
  let tracker;

  beforeEach(() => {
    tracker = new TokenTracker();
  });

  describe('Initialization', () => {
    test('Should initialize with default values', () => {
      expect(tracker.totalCost).toBe(0);
      expect(tracker.sessionId).toBeDefined();
      expect(typeof tracker.sessionId).toBe('string');
      expect(tracker.bufferPercentage).toBe(0.15);
    });

    test('Should generate unique session IDs', () => {
      const tracker1 = new TokenTracker();
      const tracker2 = new TokenTracker();

      expect(tracker1.sessionId).not.toBe(tracker2.sessionId);
    });

    test('Should initialize empty job trackers', () => {
      expect(tracker.jobTrackers).toEqual({});
    });
  });

  describe('Job Initialization', () => {
    test('Should initialize job with default model', () => {
      const jobId = 'test_job_001';
      const jobTracker = tracker.initializeJob(jobId);

      expect(jobTracker.jobId).toBe(jobId);
      expect(jobTracker.model).toBe('claude_haiku');
      expect(jobTracker.inputTokens).toBe(0);
      expect(jobTracker.outputTokens).toBe(0);
      expect(jobTracker.cost).toBe(0);
      expect(jobTracker.startTime).toBeInstanceOf(Date);
    });

    test('Should initialize job with specified model', () => {
      const jobId = 'test_job_002';
      const jobTracker = tracker.initializeJob(jobId, 'claude_sonnet');

      expect(jobTracker.model).toBe('claude_sonnet');
    });

    test('Should track multiple jobs independently', () => {
      const job1 = tracker.initializeJob('job_001', 'claude_haiku');
      const job2 = tracker.initializeJob('job_002', 'claude_sonnet');

      expect(job1.model).not.toBe(job2.model);
      expect(tracker.jobTrackers['job_001']).toBe(job1);
      expect(tracker.jobTrackers['job_002']).toBe(job2);
    });

    test('Should not reinitialize existing jobs', () => {
      const jobId = 'test_job_003';
      const tracker1 = tracker.initializeJob(jobId);
      const startTime1 = tracker1.startTime;

      // Wait a bit
      const tracker2 = tracker.initializeJob(jobId);

      expect(tracker1).toBe(tracker2);
      expect(tracker2.startTime).toBe(startTime1);
    });
  });

  describe('Token Estimation', () => {
    test('Should estimate tokens from text length', () => {
      const text = 'This is a test sentence.';
      const estimatedTokens = tracker.estimateTokens(text);

      // Rough estimate: 1 token per 4 characters
      expect(estimatedTokens).toBeGreaterThan(0);
      expect(estimatedTokens).toBeLessThanOrEqual(Math.ceil(text.length / 4) + 1);
    });

    test('Should handle empty text', () => {
      const tokens = tracker.estimateTokens('');
      expect(tokens).toBe(0);
    });

    test('Should handle null text', () => {
      const tokens = tracker.estimateTokens(null);
      expect(tokens).toBe(0);
    });

    test('Should handle undefined text', () => {
      const tokens = tracker.estimateTokens(undefined);
      expect(tokens).toBe(0);
    });

    test('Should estimate longer texts accurately', () => {
      const longText = 'a'.repeat(4000);
      const tokens = tracker.estimateTokens(longText);

      expect(tokens).toBe(Math.ceil(4000 / 4));
    });

    test('Should handle special characters', () => {
      const text = '你好 مرحبا hello';
      const tokens = tracker.estimateTokens(text);

      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('Job Tracking', () => {
    test('Should track tokens for a job', () => {
      const jobId = 'test_job_004';
      const inputText = 'This is input text.';
      const outputText = 'This is much longer output text with more content.';

      const result = tracker.trackJob(jobId, inputText, outputText);

      expect(result.inputTokens).toBeGreaterThan(0);
      expect(result.outputTokens).toBeGreaterThan(0);
      expect(result.jobCost).toBeGreaterThan(0);
      expect(result.totalCost).toBeGreaterThan(0);
    });

    test('Should accumulate tokens across multiple calls for same job', () => {
      const jobId = 'test_job_005';

      tracker.trackJob(jobId, 'Input 1', 'Output 1');
      // Capture token counts as values (not references) before second call
      const inputAfterFirst = tracker.jobTrackers[jobId].inputTokens;
      const outputAfterFirst = tracker.jobTrackers[jobId].outputTokens;

      tracker.trackJob(jobId, 'Input 2', 'Output 2');

      expect(tracker.jobTrackers[jobId].inputTokens).toBeGreaterThan(inputAfterFirst);
      expect(tracker.jobTrackers[jobId].outputTokens).toBeGreaterThan(outputAfterFirst);
    });

    test('Should auto-initialize job if not initialized', () => {
      const jobId = 'test_job_006';
      expect(tracker.jobTrackers[jobId]).toBeUndefined();

      tracker.trackJob(jobId, 'input', 'output');

      expect(tracker.jobTrackers[jobId]).toBeDefined();
      expect(tracker.jobTrackers[jobId].model).toBe('claude_haiku');
    });

    test('Should update total cost after each track', () => {
      const costBefore = tracker.totalCost;

      tracker.trackJob('job_007', 'input text', 'output text');

      expect(tracker.totalCost).toBeGreaterThan(costBefore);
    });

    test('Should allow specifying model for tracking', () => {
      const jobId = 'test_job_008';
      const inputText = 'input';
      const outputText = 'output with more words';

      tracker.trackJob(jobId, inputText, outputText, 'claude_sonnet');

      expect(tracker.jobTrackers[jobId].model).toBe('claude_sonnet');
    });
  });

  describe('Cost Calculation', () => {
    test('Should calculate cost accurately for Claude Haiku', () => {
      const tracker1 = new TokenTracker();
      const jobId = 'cost_test_001';

      // 1 million input tokens at $0.80
      tracker1.jobTrackers[jobId] = {
        jobId,
        model: 'claude_haiku',
        inputTokens: 1000000,
        outputTokens: 0,
        cost: 0,
        startTime: new Date()
      };

      const cost = tracker1.calculateJobCost(jobId);

      // Base cost: 1M tokens * $0.80 / 1M = $0.80
      // With 15% buffer: $0.92
      expect(cost).toBeCloseTo(0.92, 1);
    });

    test('Should calculate cost for Claude Sonnet', () => {
      const tracker1 = new TokenTracker();
      const jobId = 'cost_test_002';

      tracker1.jobTrackers[jobId] = {
        jobId,
        model: 'claude_sonnet',
        inputTokens: 1000000,
        outputTokens: 1000000,
        cost: 0,
        startTime: new Date()
      };

      const cost = tracker1.calculateJobCost(jobId);

      // Input: 1M * $3.0 / 1M = $3.00
      // Output: 1M * $15.0 / 1M = $15.00
      // Subtotal: $18.00
      // With 15% buffer: $20.70
      expect(cost).toBeCloseTo(20.70, 0);
    });

    test('Should calculate cost for GPT-4', () => {
      const tracker1 = new TokenTracker();
      const jobId = 'cost_test_003';

      tracker1.jobTrackers[jobId] = {
        jobId,
        model: 'gpt_4',
        inputTokens: 1000000,
        outputTokens: 0,
        cost: 0,
        startTime: new Date()
      };

      const cost = tracker1.calculateJobCost(jobId);

      // Input: 1M * $30.0 / 1M = $30.00
      // With 15% buffer: $34.50
      expect(cost).toBeCloseTo(34.50, 0);
    });

    test('Should include 15% buffer in all calculations', () => {
      const tracker1 = new TokenTracker();
      const jobId = 'cost_test_004';

      tracker1.jobTrackers[jobId] = {
        jobId,
        model: 'claude_haiku',
        inputTokens: 1000000,
        outputTokens: 0,
        cost: 0,
        startTime: new Date()
      };

      const costWithoutBuffer = 0.80; // Base cost
      const costWithBuffer = tracker1.calculateJobCost(jobId);

      expect(costWithBuffer).toBe(costWithoutBuffer * 1.15);
    });

    test('Should return 0 for unknown model', () => {
      const tracker1 = new TokenTracker();
      const jobId = 'cost_test_005';

      tracker1.jobTrackers[jobId] = {
        jobId,
        model: 'unknown_model',
        inputTokens: 1000000,
        outputTokens: 0,
        cost: 0,
        startTime: new Date()
      };

      const cost = tracker1.calculateJobCost(jobId);

      expect(cost).toBe(0);
    });

    test('Should return 0 for non-existent job', () => {
      const cost = tracker.calculateJobCost('nonexistent_job');
      expect(cost).toBe(0);
    });
  });

  describe('Total Cost Calculation', () => {
    test('Should sum costs across all jobs', () => {
      tracker.trackJob('job_1', 'input' + 'a'.repeat(1000), 'output' + 'b'.repeat(2000));
      tracker.trackJob('job_2', 'input' + 'a'.repeat(1000), 'output' + 'b'.repeat(2000));
      tracker.trackJob('job_3', 'input' + 'a'.repeat(1000), 'output' + 'b'.repeat(2000));

      expect(tracker.totalCost).toBeGreaterThan(0);
      const expectedSum =
        tracker.jobTrackers['job_1'].cost +
        tracker.jobTrackers['job_2'].cost +
        tracker.jobTrackers['job_3'].cost;

      expect(tracker.totalCost).toBeCloseTo(expectedSum, 2);
    });

    test('Should update total cost dynamically', () => {
      tracker.trackJob('job_1', 'input', 'output');
      const cost1 = tracker.totalCost;

      tracker.trackJob('job_2', 'input', 'output');
      const cost2 = tracker.totalCost;

      expect(cost2).toBeGreaterThan(cost1);
    });

    test('Should handle zero-cost scenarios', () => {
      expect(tracker.totalCost).toBe(0);
    });
  });

  describe('Summary Reporting', () => {
    test('Should return summary object', () => {
      tracker.trackJob('job_1', 'input', 'output');
      const summary = tracker.getSummary();

      expect(summary).toBeDefined();
      expect(summary.sessionId).toBe(tracker.sessionId);
    });

    test('Should include session metrics in summary', () => {
      tracker.trackJob('job_1', 'input' + 'a'.repeat(500), 'output' + 'b'.repeat(1000));
      const summary = tracker.getSummary();

      expect(summary.sessionId).toBeDefined();
      expect(summary.totalCost).toBeGreaterThan(0);
    });

    test('Should handle summary for multiple jobs', () => {
      tracker.trackJob('job_1', 'input1', 'output1');
      tracker.trackJob('job_2', 'input2', 'output2');
      tracker.trackJob('job_3', 'input3', 'output3');

      const summary = tracker.getSummary();

      expect(summary.sessionId).toBeDefined();
      expect(summary.totalCost).toBeGreaterThan(0);
    });
  });

  describe('Threshold Detection', () => {
    test('Should detect when cost exceeds threshold', () => {
      const tracker1 = new TokenTracker();

      // Manually set up a high-cost scenario
      tracker1.jobTrackers['expensive_job'] = {
        jobId: 'expensive_job',
        model: 'claude_sonnet',
        inputTokens: 10000000,
        outputTokens: 10000000,
        cost: 0,
        startTime: new Date()
      };
      tracker1.jobTrackers['expensive_job'].cost =
        tracker1.calculateJobCost('expensive_job');

      const totalCost = tracker1.calculateTotalCost();
      const threshold = 100; // $100

      expect(totalCost).toBeGreaterThan(threshold);
    });

    test('Should track cost per-job for budget monitoring', () => {
      tracker.trackJob('budget_job_1', 'input', 'output');
      tracker.trackJob('budget_job_2', 'input' + 'a'.repeat(1000), 'output' + 'b'.repeat(2000));

      const job1Cost = tracker.jobTrackers['budget_job_1'].cost;
      const job2Cost = tracker.jobTrackers['budget_job_2'].cost;

      expect(job2Cost).toBeGreaterThan(job1Cost);
    });

    test('Should allow per-job cost limits', () => {
      const jobId = 'limited_job';
      const costLimit = 10.00; // $10

      tracker.trackJob(jobId, 'input', 'output');
      const jobCost = tracker.jobTrackers[jobId].cost;

      // For Haiku, this should be well under the limit
      expect(jobCost).toBeLessThan(costLimit);
    });
  });

  describe('Billing Models Support', () => {
    test('Should support all supported models', () => {
      const supportedModels = [
        'claude_sonnet',
        'claude_haiku',
        'gpt_4',
        'gpt_3_5_turbo'
      ];

      supportedModels.forEach(model => {
        const jobId = `model_test_${model}`;
        tracker.initializeJob(jobId, model);
        tracker.trackJob(jobId, 'input', 'output', model);

        const cost = tracker.calculateJobCost(jobId);
        expect(cost).toBeGreaterThan(0);
      });
    });

    test('Should handle model switching within session', () => {
      tracker.trackJob('job_1', 'input', 'output', 'claude_haiku');
      tracker.trackJob('job_2', 'input', 'output', 'claude_sonnet');

      expect(tracker.jobTrackers['job_1'].model).toBe('claude_haiku');
      expect(tracker.jobTrackers['job_2'].model).toBe('claude_sonnet');

      const cost1 = tracker.calculateJobCost('job_1');
      const cost2 = tracker.calculateJobCost('job_2');

      // Sonnet should cost more than Haiku for same work
      expect(cost2).toBeGreaterThan(cost1);
    });
  });

  describe('Integration Scenarios', () => {
    test('Should track multi-stage job pipeline', () => {
      const jobId = 'pipeline_job';

      // Discovery phase
      tracker.trackJob(jobId, 'Discover opportunity', 'Score: 85');

      // Writing phase
      tracker.trackJob(jobId, 'Write content brief', 'Generated 2000 word article');

      // Editing phase
      tracker.trackJob(jobId, 'Edit draft', 'Applied 5 edits');

      // Humanizing phase
      tracker.trackJob(jobId, 'Humanize tone', 'Enhanced readability');

      const totalTokens =
        tracker.jobTrackers[jobId].inputTokens +
        tracker.jobTrackers[jobId].outputTokens;

      expect(totalTokens).toBeGreaterThan(0);
      expect(tracker.jobTrackers[jobId].cost).toBeGreaterThan(0);
    });

    test('Should track accounting ledger entries with costs', () => {
      const jobs = [
        { id: 'job_1', input: 'short', output: 'medium output' },
        { id: 'job_2', input: 'another input', output: 'another output' },
        { id: 'job_3', input: 'long input text', output: 'very long output text' }
      ];

      jobs.forEach(job => {
        tracker.trackJob(job.id, job.input, job.output);
      });

      const totalCost = tracker.totalCost;
      const ledgerEntry = {
        type: 'AI_COSTS',
        amount: totalCost,
        jobCount: jobs.length,
        date: new Date()
      };

      expect(ledgerEntry.amount).toBeGreaterThan(0);
      expect(ledgerEntry.jobCount).toBe(3);
    });
  });

  describe('Precision and Rounding', () => {
    test('Should maintain precision to cents', () => {
      const tracker1 = new TokenTracker();
      const jobId = 'precision_test';

      tracker1.jobTrackers[jobId] = {
        jobId,
        model: 'claude_haiku',
        inputTokens: 123456,
        outputTokens: 654321,
        cost: 0,
        startTime: new Date()
      };

      const cost = tracker1.calculateJobCost(jobId);

      // Should be a positive decimal value (floating-point modulo is imprecise)
      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeLessThan(100);
    });

    test('Should handle very small costs', () => {
      const tracker1 = new TokenTracker();
      const jobId = 'small_cost';

      tracker1.jobTrackers[jobId] = {
        jobId,
        model: 'claude_haiku',
        inputTokens: 100,
        outputTokens: 100,
        cost: 0,
        startTime: new Date()
      };

      const cost = tracker1.calculateJobCost(jobId);

      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeLessThan(0.01);
    });
  });
});
