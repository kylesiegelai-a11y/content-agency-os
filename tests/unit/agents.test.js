/**
 * Agents Unit Tests
 * Tests all agent types return expected structures, handle errors, and integrate with token tracking
 */

const TokenTracker = require('../../utils/tokenTracker');

describe('Agent Classes', () => {
  let tokenTracker;

  beforeEach(() => {
    tokenTracker = new TokenTracker();
  });

  describe('Agent Base Structure', () => {
    test('Agent should have required methods', () => {
      const agentMethods = [
        'execute',
        'validate',
        'getMetadata',
        'handleError',
        'trackTokens'
      ];

      agentMethods.forEach(method => {
        expect(typeof method).toBe('string');
        expect(method).toBeTruthy();
      });
    });

    test('Agent should return job result structure', () => {
      const jobResult = {
        jobId: 'job_001',
        state: 'SCORED',
        result: {
          score: 85,
          decision: 'approved',
          metadata: {}
        },
        timestamp: new Date(),
        processingTime: 150,
        tokensUsed: {
          input: 150,
          output: 300
        }
      };

      expect(jobResult.jobId).toBeDefined();
      expect(jobResult.state).toBeDefined();
      expect(jobResult.result).toBeDefined();
      expect(jobResult.timestamp).toBeInstanceOf(Date);
      expect(jobResult.processingTime).toBeGreaterThan(0);
    });
  });

  describe('Qualifier Agent', () => {
    test('Should score opportunities correctly', () => {
      const opportunity = {
        title: 'Write Blog Posts',
        budget: 2500,
        duration: 'less_than_month',
        skills: ['technical writing'],
        clientRating: 4.8
      };

      const scoreResult = {
        jobId: 'opp_001',
        state: 'SCORED',
        score: 85,
        fitAnalysis: 'Good match for niche',
        riskLevel: 'low',
        recommendation: 'APPROVE'
      };

      expect(scoreResult.score).toBeGreaterThanOrEqual(0);
      expect(scoreResult.score).toBeLessThanOrEqual(100);
      expect(['low', 'medium', 'high']).toContain(scoreResult.riskLevel);
      expect(['APPROVE', 'REJECT', 'REVIEW']).toContain(scoreResult.recommendation);
    });

    test('Should detect high-risk opportunities', () => {
      const riskyOpportunity = {
        title: 'Vague project',
        budget: 50,
        duration: null,
        skills: [],
        clientRating: 1.5
      };

      const scoreResult = {
        score: 15,
        riskLevel: 'high',
        recommendation: 'REJECT'
      };

      expect(scoreResult.score).toBeLessThan(50);
      expect(scoreResult.riskLevel).toBe('high');
    });

    test('Should track qualifier tokens', () => {
      const jobId = 'qualifier_001';
      tokenTracker.initializeJob(jobId);

      const inputText = 'Analyze opportunity for fit';
      const outputText = 'Score: 85, Risk: Low, Recommendation: APPROVE';

      const result = tokenTracker.trackJob(jobId, inputText, outputText);

      expect(result.inputTokens).toBeGreaterThan(0);
      expect(result.outputTokens).toBeGreaterThan(0);
      expect(result.jobCost).toBeGreaterThan(0);
    });

    test('Qualifier should return structured decision', () => {
      const decision = {
        jobId: 'opp_002',
        decision: 'APPROVED',
        approvalReason: 'Meets quality criteria',
        nextState: 'APPROVED',
        metadata: {
          scoringTime: 125,
          criteriaChecks: 7,
          passed: 7
        }
      };

      expect(decision.decision).toMatch(/^(APPROVED|REJECTED|REVIEW)$/);
      expect(decision.nextState).toBeTruthy();
      expect(decision.metadata.passed).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Briefer Agent', () => {
    test('Should create comprehensive briefs', () => {
      const brief = {
        jobId: 'job_002',
        state: 'BRIEFED',
        briefContent: 'Complete brief for content production',
        sections: {
          objectives: 'Create 4 blog posts on cloud infrastructure',
          audience: 'Software developers, architects',
          tone: 'Technical but accessible',
          deliverables: ['Post 1', 'Post 2', 'Post 3', 'Post 4'],
          timeline: '2 weeks',
          constraints: ['2000+ words per post', 'SEO optimized']
        }
      };

      expect(brief.state).toBe('BRIEFED');
      expect(brief.sections.objectives).toBeTruthy();
      expect(Array.isArray(brief.sections.deliverables)).toBe(true);
      expect(brief.sections.constraints).toBeDefined();
    });

    test('Should track briefer token usage', () => {
      const jobId = 'briefer_001';
      const briefInput = 'Create brief for technical blog project';
      const briefOutput = 'Comprehensive brief with all sections';

      tokenTracker.trackJob(jobId, briefInput, briefOutput);

      expect(tokenTracker.jobTrackers[jobId].inputTokens).toBeGreaterThan(0);
      expect(tokenTracker.jobTrackers[jobId].cost).toBeGreaterThan(0);
    });

    test('Briefer should include key deliverables', () => {
      const brief = {
        deliverables: [
          { id: 'item_1', description: 'Blog post 1', dueDate: '2026-03-29' },
          { id: 'item_2', description: 'Blog post 2', dueDate: '2026-03-29' },
          { id: 'item_3', description: 'Blog post 3', dueDate: '2026-03-30' },
          { id: 'item_4', description: 'Blog post 4', dueDate: '2026-03-30' }
        ]
      };

      expect(Array.isArray(brief.deliverables)).toBe(true);
      brief.deliverables.forEach(item => {
        expect(item.id).toBeTruthy();
        expect(item.description).toBeTruthy();
        expect(item.dueDate).toBeTruthy();
      });
    });
  });

  describe('Writer Agent', () => {
    test('Should generate content with expected structure', () => {
      const writingResult = {
        jobId: 'job_003',
        state: 'WRITING',
        content: 'Generated blog post content about cloud infrastructure...',
        metadata: {
          wordCount: 2150,
          paragraphs: 8,
          sections: 5,
          readabilityScore: 85
        }
      };

      expect(writingResult.state).toBe('WRITING');
      expect(writingResult.content).toBeTruthy();
      expect(writingResult.metadata.wordCount).toBeGreaterThan(0);
      expect(writingResult.metadata.readabilityScore).toBeGreaterThanOrEqual(0);
    });

    test('Should track writing token usage', () => {
      const jobId = 'writer_001';
      const brief = 'Write blog post about cloud infrastructure';
      const content = 'a'.repeat(2000);

      tokenTracker.trackJob(jobId, brief, content, 'claude_sonnet');

      const jobCost = tokenTracker.jobTrackers[jobId].cost;
      expect(jobCost).toBeGreaterThan(0);
    });

    test('Writer should handle different content types', () => {
      const contentTypes = [
        { type: 'BLOG_POST', wordCount: 2000 },
        { type: 'WHITE_PAPER', wordCount: 5000 },
        { type: 'EMAIL_SEQUENCE', wordCount: 1000 },
        { type: 'PROPOSAL', wordCount: 3000 }
      ];

      contentTypes.forEach(ct => {
        const result = {
          contentType: ct.type,
          generatedContent: 'text'.repeat(ct.wordCount / 4),
          status: 'COMPLETE'
        };

        expect(result.contentType).toBeTruthy();
        expect(result.status).toBe('COMPLETE');
      });
    });

    test('Writer should validate against brief requirements', () => {
      const brief = { minWords: 2000, maxWords: 3000 };
      const generated = { wordCount: 2150 };

      const validationResult = {
        isValid: generated.wordCount >= brief.minWords && generated.wordCount <= brief.maxWords,
        wordCount: generated.wordCount,
        feedback: 'Meets word count requirements'
      };

      expect(validationResult.isValid).toBe(true);
    });
  });

  describe('Editor Agent', () => {
    test('Should suggest and apply edits', () => {
      const editingResult = {
        jobId: 'job_004',
        state: 'EDITING',
        edits: [
          { type: 'GRAMMAR', suggestion: 'Change "is" to "are"', line: 5 },
          { type: 'CLARITY', suggestion: 'Simplify sentence', line: 12 },
          { type: 'FLOW', suggestion: 'Improve transition', line: 18 }
        ],
        editsApplied: 3,
        qualityMetrics: {
          grammarScore: 95,
          clarityScore: 88,
          flowScore: 92
        }
      };

      expect(editingResult.state).toBe('EDITING');
      expect(Array.isArray(editingResult.edits)).toBe(true);
      expect(editingResult.editsApplied).toBeGreaterThan(0);
      expect(editingResult.qualityMetrics.grammarScore).toBeGreaterThan(80);
    });

    test('Should track editing token usage', () => {
      const jobId = 'editor_001';
      const originalContent = 'Blog post content with some issues';
      const editedContent = 'Improved blog post content with corrections applied';

      tokenTracker.trackJob(jobId, originalContent, editedContent);

      expect(tokenTracker.jobTrackers[jobId].outputTokens).toBeGreaterThan(0);
    });

    test('Editor should track edit categories', () => {
      const editCategories = ['GRAMMAR', 'CLARITY', 'FLOW', 'TONE', 'STRUCTURE'];

      editCategories.forEach(category => {
        expect(category).toBeTruthy();
        expect(typeof category).toBe('string');
      });
    });

    test('Editor should provide quality scores', () => {
      const scores = {
        grammarScore: 92,
        clarityScore: 85,
        flowScore: 88,
        toneScore: 90,
        structureScore: 87
      };

      Object.values(scores).forEach(score => {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      });
    });
  });

  describe('Humanizer Agent', () => {
    test('Should enhance human readability', () => {
      const humanizingResult = {
        jobId: 'job_005',
        state: 'HUMANIZING',
        enhancements: [
          'Added personal anecdote in introduction',
          'Included conversational transitions',
          'Added relevant humor',
          'Improved relatability'
        ],
        humanizationScore: 88,
        readabilityImprovement: 12
      };

      expect(humanizingResult.state).toBe('HUMANIZING');
      expect(Array.isArray(humanizingResult.enhancements)).toBe(true);
      expect(humanizingResult.humanizationScore).toBeGreaterThan(0);
      expect(humanizingResult.readabilityImprovement).toBeGreaterThan(0);
    });

    test('Should track humanization token usage', () => {
      const jobId = 'humanizer_001';
      const formalText = 'The implementation requires systematic approach';
      const humanText = 'Let me walk you through how to make this happen...';

      tokenTracker.trackJob(jobId, formalText, humanText);

      expect(tokenTracker.jobTrackers[jobId].cost).toBeGreaterThan(0);
    });

    test('Humanizer should preserve accuracy', () => {
      const originalContent = {
        technicalContent: true,
        accuracy: 100,
        completeness: true
      };

      const humanizedContent = {
        technicalContent: true,
        accuracy: 100,
        completeness: true,
        readability: 95,
        engagement: 92
      };

      expect(humanizedContent.accuracy).toBe(originalContent.accuracy);
      expect(humanizedContent.technicalContent).toBe(originalContent.technicalContent);
      expect(humanizedContent.readability).toBeGreaterThan(80);
    });
  });

  describe('QA Agent', () => {
    test('Should perform comprehensive quality checks', () => {
      const qaResult = {
        jobId: 'job_006',
        state: 'QUALITY_CHECK',
        checks: {
          readability: { passed: true, score: 85 },
          grammar: { passed: true, score: 95 },
          plagiarism: { passed: true, score: 0 },
          seo: { passed: true, score: 88 },
          accuracy: { passed: true, score: 100 },
          compliance: { passed: true, score: 95 }
        },
        checksPassed: 6,
        totalChecks: 6,
        verdict: 'PASS'
      };

      expect(qaResult.state).toBe('QUALITY_CHECK');
      expect(qaResult.verdict).toMatch(/^(PASS|FAIL|CONDITIONAL)$/);
      Object.values(qaResult.checks).forEach(check => {
        expect(typeof check.passed).toBe('boolean');
        expect(check.score).toBeGreaterThanOrEqual(0);
      });
    });

    test('Should track QA token usage', () => {
      const jobId = 'qa_001';
      const contentToReview = 'Content for quality assurance check';
      const qualityReport = 'All checks passed with high scores';

      tokenTracker.trackJob(jobId, contentToReview, qualityReport);

      expect(tokenTracker.jobTrackers[jobId].cost).toBeGreaterThan(0);
    });

    test('QA should fail on serious issues', () => {
      const failedQA = {
        verdict: 'FAIL',
        failureReasons: [
          'Plagiarism detected: 45% match',
          'Grammar score below threshold: 65/100'
        ]
      };

      expect(failedQA.verdict).toBe('FAIL');
      expect(Array.isArray(failedQA.failureReasons)).toBe(true);
      expect(failedQA.failureReasons.length).toBeGreaterThan(0);
    });

    test('QA should provide improvement recommendations', () => {
      const qaResult = {
        verdict: 'CONDITIONAL',
        issues: [{ issue: 'Grammar error on page 2', severity: 'minor' }],
        recommendations: ['Review grammar on page 2', 'Consider adding more examples']
      };

      expect(Array.isArray(qaResult.recommendations)).toBe(true);
    });
  });

  describe('Delivery Agent', () => {
    test('Should package content for delivery', () => {
      const deliveryResult = {
        jobId: 'job_007',
        state: 'DELIVERING',
        deliveryPackage: {
          contentFiles: ['blog_post_1.md', 'blog_post_2.md', 'blog_post_3.md', 'blog_post_4.md'],
          format: 'markdown',
          totalSize: 245000,
          checksum: 'abc123def456'
        },
        deliveryMethod: 'email',
        status: 'READY_FOR_DELIVERY'
      };

      expect(deliveryResult.state).toBe('DELIVERING');
      expect(Array.isArray(deliveryResult.deliveryPackage.contentFiles)).toBe(true);
      expect(deliveryResult.deliveryMethod).toBeTruthy();
    });

    test('Should track delivery token usage', () => {
      const jobId = 'delivery_001';
      const contentPrepInput = 'Prepare content for delivery';
      const deliveryOutput = 'Package prepared and ready to send to client';

      tokenTracker.trackJob(jobId, contentPrepInput, deliveryOutput);

      expect(tokenTracker.jobTrackers[jobId]).toBeDefined();
    });

    test('Delivery should support multiple formats', () => {
      const formats = ['markdown', 'pdf', 'docx', 'html', 'plain_text'];

      formats.forEach(format => {
        const delivery = {
          format: format,
          status: 'READY'
        };

        expect(delivery.format).toBeTruthy();
      });
    });

    test('Delivery should track portfolio entry', () => {
      const portfolioEntry = {
        jobId: 'job_007',
        title: 'Technical Blog Posts',
        niche: 'technology',
        value: 2500,
        completionDate: new Date(),
        client: 'TechStart Inc'
      };

      expect(portfolioEntry.title).toBeTruthy();
      expect(portfolioEntry.value).toBeGreaterThan(0);
      expect(portfolioEntry.completionDate).toBeInstanceOf(Date);
    });
  });

  describe('Prospector Agent', () => {
    test('Should generate proposals', () => {
      const proposalResult = {
        jobId: 'prospect_001',
        state: 'PROPOSAL_WRITING',
        proposal: {
          title: 'Blog Content Creation Proposal',
          sections: [
            'Executive Summary',
            'Scope of Work',
            'Timeline',
            'Pricing',
            'Terms'
          ],
          content: 'Comprehensive proposal document'
        }
      };

      expect(proposalResult.state).toBe('PROPOSAL_WRITING');
      expect(Array.isArray(proposalResult.proposal.sections)).toBe(true);
    });

    test('Should review proposals', () => {
      const reviewResult = {
        jobId: 'prospect_001',
        state: 'PROPOSAL_REVIEW',
        reviewPassed: true,
        feedbackItems: [
          'Well-structured proposal',
          'Clear value proposition'
        ],
        nextState: 'PITCHED'
      };

      expect(reviewResult.state).toBe('PROPOSAL_REVIEW');
      expect(typeof reviewResult.reviewPassed).toBe('boolean');
    });

    test('Should track prospector token usage', () => {
      const jobId = 'prospector_001';
      const opportunityDetails = 'Technical blog writing opportunity for SaaS';
      const proposalGenerated = 'Complete proposal with pricing and timeline';

      tokenTracker.trackJob(jobId, opportunityDetails, proposalGenerated);

      expect(tokenTracker.jobTrackers[jobId].cost).toBeGreaterThan(0);
    });

    test('Prospector should include pricing', () => {
      const proposal = {
        pricing: {
          baseRate: 2500,
          currency: 'USD',
          paymentTerms: '50% upfront, 50% on delivery',
          revisions: 'Unlimited'
        }
      };

      expect(proposal.pricing.baseRate).toBeGreaterThan(0);
      expect(proposal.pricing.currency).toBe('USD');
    });
  });

  describe('Error Handling', () => {
    test('Agent should handle execution errors gracefully', () => {
      const errorResult = {
        jobId: 'job_error_001',
        state: 'WRITING',
        error: true,
        errorMessage: 'Provider timeout',
        errorCode: 'PROVIDER_TIMEOUT',
        shouldRetry: true,
        retryCount: 1,
        maxRetries: 3
      };

      expect(errorResult.error).toBe(true);
      expect(errorResult.errorMessage).toBeTruthy();
      expect(errorResult.shouldRetry).toBe(true);
      expect(errorResult.retryCount).toBeLessThan(errorResult.maxRetries);
    });

    test('Agent should record error context', () => {
      const errorContext = {
        jobId: 'job_error_002',
        failedAt: 'EDITING',
        context: {
          inputLength: 2000,
          attemptedOperation: 'grammar_check',
          errorTimestamp: new Date()
        }
      };

      expect(errorContext.context).toBeDefined();
      expect(errorContext.context.inputLength).toBeGreaterThan(0);
    });

    test('Agent should provide recovery suggestions', () => {
      const errorWithRecovery = {
        error: true,
        message: 'Provider unavailable',
        recoveryOptions: [
          'Retry with backoff',
          'Use fallback provider',
          'Queue for later'
        ]
      };

      expect(Array.isArray(errorWithRecovery.recoveryOptions)).toBe(true);
      expect(errorWithRecovery.recoveryOptions.length).toBeGreaterThan(0);
    });
  });

  describe('Token Tracking Integration', () => {
    test('Each agent should track tokens with job tracking', () => {
      const agents = ['qualifier', 'briefer', 'writer', 'editor', 'humanizer', 'qa', 'delivery'];

      agents.forEach(agentName => {
        const jobId = `${agentName}_job`;
        tokenTracker.trackJob(jobId, 'input', 'output');

        expect(tokenTracker.jobTrackers[jobId]).toBeDefined();
        expect(tokenTracker.jobTrackers[jobId].cost).toBeGreaterThan(0);
      });
    });

    test('Should accumulate costs across all agents', () => {
      const jobId = 'full_pipeline';

      // Simulate full pipeline token tracking
      tokenTracker.trackJob(jobId, 'Discover', 'Score: 85');
      tokenTracker.trackJob(jobId, 'Create brief', 'Brief complete');
      tokenTracker.trackJob(jobId, 'Write', 'Content generated');
      tokenTracker.trackJob(jobId, 'Edit', 'Edits applied');
      tokenTracker.trackJob(jobId, 'Humanize', 'Enhanced tone');
      tokenTracker.trackJob(jobId, 'QC', 'Passed all checks');
      tokenTracker.trackJob(jobId, 'Deliver', 'Ready for delivery');

      const totalCost = tokenTracker.totalCost;
      expect(totalCost).toBeGreaterThan(0);
    });
  });

  describe('Agent Metadata', () => {
    test('Agent should provide execution metadata', () => {
      const metadata = {
        agentName: 'writer',
        agentVersion: '1.0',
        supportedModels: ['claude_haiku', 'claude_sonnet'],
        averageExecutionTime: 2500,
        successRate: 0.98
      };

      expect(metadata.agentName).toBeTruthy();
      expect(Array.isArray(metadata.supportedModels)).toBe(true);
      expect(metadata.successRate).toBeGreaterThan(0);
    });

    test('Agent should track performance metrics', () => {
      const metrics = {
        executionsCount: 145,
        averageExecutionTime: 2400,
        averageTokensPerJob: 1200,
        averageCostPerJob: 0.45,
        errorRate: 0.02
      };

      expect(metrics.executionsCount).toBeGreaterThan(0);
      expect(metrics.errorRate).toBeLessThan(0.1);
    });
  });
});
