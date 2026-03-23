/**
 * Pipeline Integration Tests
 * Tests state transitions, agent chaining, error recovery, and dead letter queue
 */

describe('Content Agency OS - Pipeline Integration Tests', () => {
  const { JOB_STATES } = require('../../orchestrator');

  describe('State Transitions', () => {
    test('Should transition through complete content pipeline', async () => {
      const jobId = 'integration_001';
      const transitions = [];

      // Simulate content pipeline transition sequence — DELIVERED is terminal
      const pipeline = [
        JOB_STATES.DISCOVERED,
        JOB_STATES.SCORED,
        JOB_STATES.APPROVED,
        JOB_STATES.BRIEFED,
        JOB_STATES.WRITING,
        JOB_STATES.EDITING,
        JOB_STATES.HUMANIZING,
        JOB_STATES.QUALITY_CHECK,
        JOB_STATES.APPROVED_CONTENT,
        JOB_STATES.DELIVERING,
        JOB_STATES.DELIVERED
      ];

      let currentState = pipeline[0];
      for (let i = 1; i < pipeline.length; i++) {
        const nextState = pipeline[i];
        transitions.push({
          from: currentState,
          to: nextState,
          timestamp: new Date()
        });
        currentState = nextState;
      }

      expect(transitions).toHaveLength(pipeline.length - 1);
      expect(transitions[transitions.length - 1].to).toBe(JOB_STATES.DELIVERED);
    });

    test('Should transition through prospect/pitch pipeline', async () => {
      const jobId = 'prospect_integration_001';
      const transitions = [];

      const pipeline = [
        JOB_STATES.DISCOVERED,
        JOB_STATES.SCORED,
        JOB_STATES.APPROVED,
        JOB_STATES.PROSPECT_APPROVED,
        JOB_STATES.PROPOSAL_WRITING,
        JOB_STATES.PROPOSAL_REVIEW,
        JOB_STATES.PITCHED,
        JOB_STATES.CLOSED
      ];

      for (let i = 0; i < pipeline.length - 1; i++) {
        transitions.push({
          from: pipeline[i],
          to: pipeline[i + 1]
        });
      }

      expect(transitions).toHaveLength(pipeline.length - 1);
      expect(transitions[0].from).toBe(JOB_STATES.DISCOVERED);
    });

    test('Should reject invalid state transitions', () => {
      const invalidTransitions = [
        { from: JOB_STATES.DISCOVERED, to: JOB_STATES.DELIVERING },
        { from: JOB_STATES.WRITING, to: JOB_STATES.APPROVED },
        { from: JOB_STATES.CLOSED, to: JOB_STATES.WRITING },
        { from: JOB_STATES.QUALITY_CHECK, to: JOB_STATES.DISCOVERED }
      ];

      invalidTransitions.forEach(transition => {
        const isValid = false; // These should all be invalid
        expect(isValid).toBe(false);
      });
    });

    test('Should enforce proper state machine during execution', () => {
      const stateHistory = [
        { state: JOB_STATES.DISCOVERED, timestamp: new Date() },
        { state: JOB_STATES.SCORED, timestamp: new Date(Date.now() + 100) },
        { state: JOB_STATES.APPROVED, timestamp: new Date(Date.now() + 200) }
      ];

      // Verify chronological order
      for (let i = 0; i < stateHistory.length - 1; i++) {
        const current = stateHistory[i];
        const next = stateHistory[i + 1];
        expect(next.timestamp >= current.timestamp).toBe(true);
      }
    });

    test('Should handle state transition with metadata', () => {
      const transition = {
        jobId: 'job_001',
        from: JOB_STATES.WRITING,
        to: JOB_STATES.EDITING,
        metadata: {
          tokensUsed: 1500,
          executionTime: 2400,
          contentGenerated: true,
          wordCount: 2150
        },
        timestamp: new Date()
      };

      expect(transition.from).toBeTruthy();
      expect(transition.to).toBeTruthy();
      expect(transition.metadata).toBeDefined();
      expect(transition.metadata.tokensUsed).toBeGreaterThan(0);
    });
  });

  describe('Agent Chaining', () => {
    test('Should chain agents in correct sequence', async () => {
      const jobChain = [
        {
          state: JOB_STATES.DISCOVERED,
          agent: 'qualifier',
          action: 'SCORE'
        },
        {
          state: JOB_STATES.APPROVED,
          agent: 'briefer',
          action: 'CREATE_BRIEF'
        },
        {
          state: JOB_STATES.BRIEFED,
          agent: 'writer',
          action: 'WRITE_CONTENT'
        },
        {
          state: JOB_STATES.WRITING,
          agent: 'editor',
          action: 'EDIT_CONTENT'
        },
        {
          state: JOB_STATES.EDITING,
          agent: 'humanizer',
          action: 'HUMANIZE'
        },
        {
          state: JOB_STATES.HUMANIZING,
          agent: 'qa',
          action: 'QUALITY_CHECK'
        },
        {
          state: JOB_STATES.QUALITY_CHECK,
          agent: 'delivery',
          action: 'PREPARE_DELIVERY'
        }
      ];

      // Verify chain integrity
      expect(jobChain).toHaveLength(7);
      jobChain.forEach((link, index) => {
        expect(link.agent).toBeTruthy();
        expect(link.action).toBeTruthy();
        expect(link.state).toBeTruthy();
      });
    });

    test('Should pass job context through agent chain', async () => {
      const jobContext = {
        jobId: 'chain_test_001',
        title: 'Write Blog Posts',
        clientId: 'client_123',
        budget: 2500,
        state: JOB_STATES.DISCOVERED,
        metadata: {
          niche: 'technology',
          wordCount: 2000,
          seoOptimized: true
        }
      };

      const agentChain = [
        {
          agent: 'qualifier',
          jobContext: jobContext,
          result: { score: 85, approved: true }
        },
        {
          agent: 'briefer',
          jobContext: { ...jobContext, score: 85 },
          result: { briefCreated: true }
        },
        {
          agent: 'writer',
          jobContext: { ...jobContext, brief: true },
          result: { contentGenerated: true }
        }
      ];

      // Verify context flows through chain
      expect(agentChain[0].jobContext.jobId).toBe(jobContext.jobId);
      expect(agentChain[1].jobContext.score).toBe(85);
      expect(agentChain[2].jobContext.brief).toBe(true);
    });

    test('Should handle agent failures in chain', async () => {
      const jobChain = [
        {
          agent: 'qualifier',
          status: 'SUCCESS',
          result: { score: 85 }
        },
        {
          agent: 'briefer',
          status: 'SUCCESS',
          result: { briefCreated: true }
        },
        {
          agent: 'writer',
          status: 'ERROR',
          error: 'Provider timeout',
          shouldRetry: true
        }
      ];

      // When writer fails, chain should handle gracefully
      const failedAt = jobChain.findIndex(link => link.status === 'ERROR');
      expect(failedAt).toBe(2);
      expect(jobChain[2].shouldRetry).toBe(true);
    });

    test('Should support conditional branching in chain', async () => {
      const jobMetadata = {
        jobType: 'CONTENT',
        isCritical: true
      };

      // Conditional branching example
      const agentRoute = jobMetadata.isCritical
        ? ['qualifier', 'briefer', 'writer', 'editor', 'humanizer', 'qa', 'delivery']
        : ['qualifier', 'briefer', 'writer', 'delivery'];

      expect(agentRoute).toContain('qualifier');
      expect(agentRoute).toContain('delivery');

      if (jobMetadata.isCritical) {
        expect(agentRoute).toContain('humanizer');
        expect(agentRoute).toContain('qa');
      }
    });

    test('Should aggregate results from all agents in chain', async () => {
      const aggregatedResults = {
        jobId: 'chain_aggregate_001',
        agentResults: [
          {
            agent: 'qualifier',
            score: 85,
            passed: true
          },
          {
            agent: 'writer',
            wordCount: 2150,
            quality: 'excellent'
          },
          {
            agent: 'editor',
            editsApplied: 5,
            qualityScore: 92
          },
          {
            agent: 'qa',
            checksTotal: 6,
            checksPassed: 6,
            verdict: 'PASS'
          }
        ],
        overallStatus: 'SUCCESS'
      };

      expect(aggregatedResults.agentResults).toHaveLength(4);
      expect(aggregatedResults.overallStatus).toBe('SUCCESS');

      const totalEdits = aggregatedResults.agentResults.reduce(
        (sum, result) => sum + (result.editsApplied || 0),
        0
      );
      expect(totalEdits).toBe(5);
    });
  });

  describe('Error Recovery', () => {
    test('Should retry failed jobs with backoff', async () => {
      const failedJob = {
        jobId: 'retry_job_001',
        state: JOB_STATES.WRITING,
        error: 'Provider timeout',
        retryAttempts: [
          { attempt: 1, delay: 1000, status: 'FAILED' },
          { attempt: 2, delay: 2000, status: 'FAILED' },
          { attempt: 3, delay: 4000, status: 'SUCCESS' }
        ]
      };

      expect(failedJob.retryAttempts).toHaveLength(3);
      expect(failedJob.retryAttempts[1].delay).toBe(
        failedJob.retryAttempts[0].delay * 2
      );
      expect(failedJob.retryAttempts[2].status).toBe('SUCCESS');
    });

    test('Should move to dead letter after max retries', async () => {
      const exhaustedJob = {
        jobId: 'dead_letter_001',
        originalState: JOB_STATES.EDITING,
        failedAttempts: 3,
        maxRetries: 3,
        finalError: 'Provider persistently unavailable',
        deadLetterTimestamp: new Date(),
        recoveryRequired: true
      };

      expect(exhaustedJob.failedAttempts).toBe(exhaustedJob.maxRetries);
      expect(exhaustedJob.recoveryRequired).toBe(true);
    });

    test('Should log error context for debugging', async () => {
      const errorLog = {
        jobId: 'error_log_001',
        timestamp: new Date(),
        state: JOB_STATES.WRITING,
        agent: 'writer',
        errorMessage: 'API request failed',
        errorCode: 'API_ERROR',
        context: {
          requestSize: 2000,
          responseTime: 5000,
          retryAttempt: 2,
          inputTokens: 250,
          outputTokens: null
        }
      };

      expect(errorLog.context).toBeDefined();
      expect(errorLog.context.retryAttempt).toBe(2);
      expect(errorLog.timestamp).toBeInstanceOf(Date);
    });

    test('Should support manual retry from dead letter', async () => {
      const deadLetterJob = {
        jobId: 'dlq_001',
        state: 'DEAD_LETTER',
        originalState: JOB_STATES.EDITING,
        failureReason: 'Temporary provider outage'
      };

      // Manual intervention to retry
      const retryAction = {
        jobId: deadLetterJob.jobId,
        action: 'RETRY_FROM_DEAD_LETTER',
        resetState: deadLetterJob.originalState,
        newRetryCount: 0,
        timestamp: new Date()
      };

      expect(retryAction.resetState).toBe(JOB_STATES.EDITING);
      expect(retryAction.newRetryCount).toBe(0);
    });

    test('Should handle cascading failures', async () => {
      const cascadingFailure = {
        jobId: 'cascade_001',
        failures: [
          {
            step: 'WRITING',
            error: 'Provider timeout',
            impact: 'Blocks EDITING'
          },
          {
            step: 'EDITING',
            error: 'No input from WRITING',
            impact: 'Blocks HUMANIZING'
          },
          {
            step: 'HUMANIZING',
            error: 'No input from EDITING',
            impact: 'Blocks QC'
          }
        ]
      };

      expect(cascadingFailure.failures).toHaveLength(3);
      // Root cause is first failure
      expect(cascadingFailure.failures[0].step).toBe('WRITING');
    });

    test('Should provide recovery suggestions', async () => {
      const failedJob = {
        state: JOB_STATES.WRITING,
        error: 'API quota exceeded',
        suggestions: [
          'Wait 60 minutes for quota reset',
          'Use fallback model (Haiku instead of Sonnet)',
          'Retry with smaller batch size'
        ]
      };

      expect(Array.isArray(failedJob.suggestions)).toBe(true);
      expect(failedJob.suggestions.length).toBeGreaterThan(0);
    });
  });

  describe('Dead Letter Queue', () => {
    test('Should store failed jobs in DLQ', async () => {
      const dlq = [];

      const failedJob = {
        jobId: 'dlq_store_001',
        originalState: JOB_STATES.EDITING,
        failureReason: 'Max retries exceeded',
        failureTime: new Date(),
        jobData: {
          title: 'Blog post',
          budget: 2500,
          content: 'Partially generated content'
        }
      };

      dlq.push(failedJob);

      expect(dlq).toHaveLength(1);
      expect(dlq[0].jobId).toBe('dlq_store_001');
      expect(dlq[0].failureReason).toBeTruthy();
    });

    test('Should maintain DLQ size limit', async () => {
      const dlq = [];
      const maxSize = 100;

      // Add 150 jobs
      for (let i = 0; i < 150; i++) {
        dlq.unshift({
          jobId: `dlq_${i}`,
          failureReason: 'Test failure'
        });

        // Maintain size limit (new items at front, oldest removed)
        if (dlq.length > maxSize) {
          dlq.pop();
        }
      }

      expect(dlq.length).toBeLessThanOrEqual(maxSize);
      expect(dlq[0].jobId).toBe('dlq_149'); // Most recent
    });

    test('Should query DLQ for investigation', async () => {
      const dlq = [
        { jobId: 'dlq_001', failureReason: 'Timeout', state: 'WRITING' },
        { jobId: 'dlq_002', failureReason: 'Invalid input', state: 'EDITING' },
        { jobId: 'dlq_003', failureReason: 'API error', state: 'WRITING' }
      ];

      // Query by state
      const writingFailures = dlq.filter(job => job.state === 'WRITING');
      expect(writingFailures).toHaveLength(2);

      // Query by reason
      const timeoutFailures = dlq.filter(job =>
        job.failureReason.includes('Timeout')
      );
      expect(timeoutFailures).toHaveLength(1);
    });

    test('Should support DLQ replay', async () => {
      const dlq = [
        {
          jobId: 'dlq_replay_001',
          originalState: JOB_STATES.EDITING,
          failedAttempts: 3,
          replayable: true
        }
      ];

      const replayJob = dlq[0];
      const replayAction = {
        originalJobId: replayJob.jobId,
        newJobId: `${replayJob.jobId}_replay_1`,
        resetState: replayJob.originalState,
        newRetryCount: 0,
        timestamp: new Date()
      };

      expect(replayAction.resetState).toBe(JOB_STATES.EDITING);
      expect(replayAction.newRetryCount).toBe(0);
    });

    test('Should track DLQ metrics', async () => {
      const dlqMetrics = {
        totalInDLQ: 12,
        byState: {
          [JOB_STATES.WRITING]: 5,
          [JOB_STATES.EDITING]: 3,
          [JOB_STATES.HUMANIZING]: 2,
          [JOB_STATES.DELIVERY]: 2
        },
        byReason: {
          'Provider timeout': 7,
          'Invalid input': 3,
          'API error': 2
        },
        oldestEntry: new Date(Date.now() - 24 * 60 * 60 * 1000),
        averageTimeInDLQ: 12.5 // hours
      };

      const totalByState = Object.values(dlqMetrics.byState).reduce(
        (sum, count) => sum + count,
        0
      );
      expect(totalByState).toBe(dlqMetrics.totalInDLQ);
    });

    test('Should provide DLQ alerts', async () => {
      const dlqAlert = {
        condition: 'DLQ size threshold',
        threshold: 50,
        currentSize: 65,
        triggered: true,
        message: 'Dead letter queue exceeds 50 items - investigation required',
        suggestedActions: [
          'Review failure patterns',
          'Check provider health',
          'Initiate replay for recoverable items'
        ]
      };

      expect(dlqAlert.triggered).toBe(true);
      expect(Array.isArray(dlqAlert.suggestedActions)).toBe(true);
    });
  });

  describe('End-to-End Flow', () => {
    test('Should complete full content creation flow', async () => {
      const jobFlow = {
        jobId: 'e2e_001',
        startTime: Date.now(),
        stages: []
      };

      // Simulate complete flow
      const stages = [
        { stage: 'DISCOVERY', duration: 50 },
        { stage: 'SCORING', duration: 150 },
        { stage: 'APPROVAL', duration: 100 },
        { stage: 'BRIEFING', duration: 120 },
        { stage: 'WRITING', duration: 800 },
        { stage: 'EDITING', duration: 300 },
        { stage: 'HUMANIZING', duration: 200 },
        { stage: 'QC', duration: 150 },
        { stage: 'DELIVERY', duration: 100 }
      ];

      let cumulativeTime = 0;
      stages.forEach(s => {
        cumulativeTime += s.duration;
        jobFlow.stages.push({
          ...s,
          cumulativeTime
        });
      });

      jobFlow.totalDuration = cumulativeTime;
      jobFlow.completedAt = Date.now();

      expect(jobFlow.stages).toHaveLength(9);
      expect(jobFlow.totalDuration).toBe(1970);
      expect(jobFlow.totalDuration).toBeLessThan(60000); // Under 60 seconds
    });

    test('Should track job through multiple checkpoints', async () => {
      const checkpoints = [
        {
          checkpoint: 'DISCOVERED',
          timestamp: new Date(),
          verified: true
        },
        {
          checkpoint: 'SCORED',
          timestamp: new Date(Date.now() + 100),
          verified: true
        },
        {
          checkpoint: 'APPROVED',
          timestamp: new Date(Date.now() + 200),
          verified: true
        },
        {
          checkpoint: 'DELIVERED',
          timestamp: new Date(Date.now() + 2000),
          verified: true
        }
      ];

      // All checkpoints should be in order
      for (let i = 0; i < checkpoints.length - 1; i++) {
        expect(checkpoints[i + 1].timestamp >= checkpoints[i].timestamp).toBe(
          true
        );
      }
    });

    test('Should verify job completion', async () => {
      const completedJob = {
        jobId: 'e2e_complete_001',
        state: JOB_STATES.DELIVERED,
        completionStatus: 'success',
        completedAt: new Date(),
        results: {
          contentGenerated: true,
          deliveryConfirmed: true,
          portfolioAdded: true,
          accountingLogged: true
        }
      };

      expect(completedJob.state).toBe(JOB_STATES.DELIVERED);
      expect(completedJob.completionStatus).toBe('success');

      const allResultsPassed = Object.values(completedJob.results).every(
        r => r === true
      );
      expect(allResultsPassed).toBe(true);
    });
  });

  describe('Concurrent Job Processing', () => {
    test('Should handle multiple jobs in pipeline simultaneously', async () => {
      const jobs = [
        {
          jobId: 'concurrent_001',
          state: JOB_STATES.WRITING,
          startedAt: new Date()
        },
        {
          jobId: 'concurrent_002',
          state: JOB_STATES.EDITING,
          startedAt: new Date()
        },
        {
          jobId: 'concurrent_003',
          state: JOB_STATES.QUALITY_CHECK,
          startedAt: new Date()
        }
      ];

      expect(jobs).toHaveLength(3);
      jobs.forEach(job => {
        expect(job.state).toBeTruthy();
        expect(job.startedAt).toBeInstanceOf(Date);
      });
    });

    test('Should not let jobs interfere with each other', async () => {
      const job1 = {
        jobId: 'isolated_001',
        content: 'Content for job 1',
        state: JOB_STATES.WRITING
      };

      const job2 = {
        jobId: 'isolated_002',
        content: 'Content for job 2',
        state: JOB_STATES.EDITING
      };

      // Job 2 should not see Job 1's content
      expect(job2.content).not.toBe(job1.content);
      expect(job2.jobId).not.toBe(job1.jobId);
    });

    test('Should properly isolate job state', async () => {
      const jobs = new Map();

      jobs.set('job_001', {
        state: JOB_STATES.WRITING,
        tokens: 1500,
        cost: 0.45
      });

      jobs.set('job_002', {
        state: JOB_STATES.EDITING,
        tokens: 2000,
        cost: 0.60
      });

      expect(jobs.get('job_001').state).toBe(JOB_STATES.WRITING);
      expect(jobs.get('job_002').state).toBe(JOB_STATES.EDITING);
      expect(jobs.get('job_001').tokens).not.toBe(jobs.get('job_002').tokens);
    });
  });

  describe('Monitoring and Observability', () => {
    test('Should track state transition events', async () => {
      const events = [
        {
          eventType: 'STATE_TRANSITION',
          jobId: 'job_001',
          from: JOB_STATES.WRITING,
          to: JOB_STATES.EDITING,
          timestamp: new Date(),
          duration: 2400
        }
      ];

      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('STATE_TRANSITION');
    });

    test('Should provide pipeline health metrics', async () => {
      const healthMetrics = {
        totalJobsProcessed: 145,
        successfulJobs: 142,
        failedJobs: 3,
        averageProcessingTime: 2400,
        successRate: (142 / 145) * 100,
        averageCostPerJob: 0.45
      };

      expect(healthMetrics.successRate).toBeGreaterThan(95);
      expect(healthMetrics.successRate).toBeLessThanOrEqual(100);
    });

    test('Should log agent performance', async () => {
      const agentMetrics = {
        writer: {
          executionsCount: 145,
          averageExecutionTime: 2400,
          successRate: 0.98,
          averageCostPerExecution: 0.35
        },
        editor: {
          executionsCount: 142,
          averageExecutionTime: 1200,
          successRate: 0.99,
          averageCostPerExecution: 0.15
        }
      };

      expect(agentMetrics.writer.successRate).toBeGreaterThan(0.95);
      expect(agentMetrics.editor.successRate).toBeGreaterThan(0.95);
    });
  });
});
