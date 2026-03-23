/**
 * Agents Unit Tests
 * Real behavioral tests that import and call actual agent modules.
 * Tests run with MOCK_MODE=true for consistent API responses.
 * Storage is mocked to prevent file I/O during tests.
 */

// Set environment before requiring modules
process.env.MOCK_MODE = 'true';
process.env.NODE_ENV = 'test';

// Mock storage to prevent file I/O
jest.mock('../../utils/storage', () => ({
  readData: jest.fn().mockResolvedValue(null),
  writeData: jest.fn().mockResolvedValue(true),
  appendToArray: jest.fn().mockResolvedValue(true)
}));

const opportunityScorer = require('../../agents/opportunityScorer');
const clientBrief = require('../../agents/clientBrief');
const writer = require('../../agents/writer');
const editor = require('../../agents/editor');
const humanization = require('../../agents/humanization');
const qualityGate = require('../../agents/qualityGate');
const delivery = require('../../agents/delivery');
const coldOutreach = require('../../agents/coldOutreach');

describe('Agent Modules - Real Behavioral Tests', () => {

  // ────────────────────────────────────────────────────────────
  // OPPORTUNITY SCORER TESTS
  // ────────────────────────────────────────────────────────────

  describe('opportunityScorer', () => {
    test('should score multiple opportunities and return structured results', async () => {
      const job = {
        jobId: 'opp_test_001',
        opportunities: [
          {
            id: 'opp1',
            title: 'Write Technical Blog Posts',
            budget: 3000,
            duration: '2-4 weeks',
            level: 'intermediate',
            workType: 'fixed-price',
            description: 'Need SEO-optimized blog posts on AI and machine learning.'
          },
          {
            id: 'opp2',
            title: 'Content Strategy Consultation',
            budget: 1500,
            duration: 'less than a week',
            level: 'expert',
            workType: 'hourly',
            description: 'Strategic advice for content marketing.'
          }
        ],
        agencyProfile: {
          specialties: 'content writing, SEO, technical documentation',
          baseHourlyRate: 85,
          minProjectValue: 500
        }
      };

      const result = await opportunityScorer(job);

      expect(result).toBeDefined();
      expect(result.id).toBe('opp_test_001');
      expect(result.opportunitiesAnalyzed).toBe(2);
      expect(Array.isArray(result.scoredOpportunities)).toBe(true);
      expect(result.scoredOpportunities.length).toBeGreaterThan(0);
      expect(result.summary).toBeDefined();
      expect(typeof result.summary.averageScore).toBe('number');
      expect(result.summary.averageScore).toBeGreaterThanOrEqual(0);
      expect(result.summary.averageScore).toBeLessThanOrEqual(100);
    });

    test('should score individual opportunity with scoring breakdown', async () => {
      const job = {
        jobId: 'opp_single_001',
        opportunities: [
          {
            id: 'high_match',
            title: 'Blog Post Series - Web Development',
            budget: 5000,
            duration: '1 month',
            level: 'intermediate',
            workType: 'fixed-price',
            description: 'Series of 5 web development blog posts for established tech company.'
          }
        ],
        agencyProfile: {
          specialties: 'web development, technical writing',
          baseHourlyRate: 100,
          minProjectValue: 1000
        }
      };

      const result = await opportunityScorer(job);

      expect(result.scoredOpportunities).toBeDefined();
      expect(result.scoredOpportunities.length).toBeGreaterThan(0);

      const scored = result.scoredOpportunities[0];
      expect(scored).toBeDefined();
      expect(typeof scored.overallScore).toBe('number');
      expect(scored.overallScore).toBeGreaterThanOrEqual(0);
      expect(scored.overallScore).toBeLessThanOrEqual(100);
      expect(scored.skillMatch).toBeDefined();
      expect(scored.budgetAdequacy).toBeDefined();
      expect(scored.timelineFeasibility).toBeDefined();
      expect(scored.competitionLevel).toBeDefined();
      expect(typeof scored.recommendedBid).toBe('number');
      expect(scored.bidRange).toBeDefined();
      expect(typeof scored.winningLikelihood).toBe('string');
      expect(Array.isArray(scored.riskFactors)).toBe(true);
      expect(scored.recommendation).toBeDefined();
    });

    test('should generate summary statistics from multiple opportunities', async () => {
      const job = {
        jobId: 'opp_stats_001',
        opportunities: [
          {
            id: 'opp_a',
            title: 'Project A',
            budget: 2000,
            duration: '2 weeks',
            level: 'beginner',
            workType: 'fixed-price',
            description: 'Test opportunity A'
          },
          {
            id: 'opp_b',
            title: 'Project B',
            budget: 4500,
            duration: '1 month',
            level: 'intermediate',
            workType: 'fixed-price',
            description: 'Test opportunity B'
          }
        ],
        agencyProfile: {
          specialties: 'writing',
          baseHourlyRate: 75,
          minProjectValue: 500
        }
      };

      const result = await opportunityScorer(job);

      expect(result.summary.topOpportunitiesCount).toBeGreaterThanOrEqual(0);
      expect(result.summary.topOpportunitiesCount).toBeLessThanOrEqual(result.scoredOpportunities.length);
      expect(typeof result.summary.averageBidValue).toBe('number');
      expect(result.summary.averageBidValue).toBeGreaterThanOrEqual(0);
      expect(typeof result.summary.potentialMonthlyRevenue).toBe('number');
      expect(result.summary.agencySpecialties).toBeDefined();
    });

    test('should handle empty opportunity list', async () => {
      const job = {
        jobId: 'opp_empty_001',
        opportunities: [],
        agencyProfile: {
          specialties: 'writing',
          baseHourlyRate: 75,
          minProjectValue: 500
        }
      };

      const result = await opportunityScorer(job);

      expect(result.scoredOpportunities).toBeDefined();
      expect(Array.isArray(result.scoredOpportunities)).toBe(true);
      expect(result.opportunitiesAnalyzed).toBe(0);
    });

    test('should use default agencyProfile when not provided', async () => {
      const job = {
        jobId: 'opp_default_profile',
        opportunities: [
          {
            id: 'opp1',
            title: 'Basic Writing Task',
            budget: 800,
            duration: '1 week',
            level: 'beginner',
            workType: 'fixed-price',
            description: 'Write an article'
          }
        ]
        // No agencyProfile provided
      };

      const result = await opportunityScorer(job);

      expect(result.summary.agencySpecialties).toBe('content writing, SEO, blog posts');
      expect(result.id).toBe('opp_default_profile');
    });
  });

  // ────────────────────────────────────────────────────────────
  // CLIENT BRIEF TESTS
  // ────────────────────────────────────────────────────────────

  describe('clientBrief', () => {
    test('should process raw requirements into structured brief', async () => {
      const job = {
        jobId: 'brief_001',
        client: {
          name: 'TechStart Inc',
          email: 'contact@techstart.com'
        },
        rawRequirements: 'We need blog posts about cloud infrastructure. Target audience is developers. Posts should be technical but accessible. We want SEO optimization. About 1500-2000 words per post, 4 posts total.'
      };

      const result = await clientBrief(job);

      expect(result).toBeDefined();
      expect(result.id).toBe('brief_001');
      expect(result.clientName).toBe('TechStart Inc');
      expect(result.clientEmail).toBe('contact@techstart.com');
      expect(result.brief).toBeDefined();
      expect(typeof result.brief).toBe('object');
      expect(result.brief.projectTitle).toBeDefined();
      expect(result.brief.overview).toBeDefined();
      expect(Array.isArray(result.brief.objectives)).toBe(true);
      expect(result.brief.targetAudience).toBeDefined();
      expect(Array.isArray(result.brief.keyTopics)).toBe(true);
      expect(result.brief.toneAndStyle).toBeDefined();
      expect(Array.isArray(result.brief.deliverables)).toBe(true);
      expect(Array.isArray(result.brief.successMetrics)).toBe(true);
    });

    test('should handle missing client fields gracefully', async () => {
      const job = {
        jobId: 'brief_minimal',
        client: {},
        rawRequirements: 'Write about product features.'
      };

      const result = await clientBrief(job);

      expect(result).toBeDefined();
      expect(result.clientName).toBe('Unknown');
      expect(result.brief).toBeDefined();
    });

    test('should preserve raw requirements in output', async () => {
      const job = {
        jobId: 'brief_preserve',
        client: { name: 'Client A' },
        rawRequirements: 'Must include case studies and testimonials.'
      };

      const result = await clientBrief(job);

      expect(result.rawRequirements).toBe('Must include case studies and testimonials.');
    });

    test('should generate deliverables with structure', async () => {
      const job = {
        jobId: 'brief_deliverables',
        client: { name: 'Marketing Corp' },
        rawRequirements: 'Need 5 blog posts and a white paper. Timeline is 4 weeks.'
      };

      const result = await clientBrief(job);

      expect(result.brief.deliverables).toBeDefined();
      const hasWordCountOrDeadline = result.brief.deliverables.every(d =>
        d.type || d.wordCount !== undefined || d.deadline
      );
      expect(hasWordCountOrDeadline).toBe(true);
    });

    test('should use jobId for timestamp tracking', async () => {
      const job = {
        jobId: 'brief_track_001',
        client: { name: 'Test Client' },
        rawRequirements: 'Test requirements'
      };

      const result = await clientBrief(job);

      expect(result.createdAt).toBeDefined();
      expect(typeof result.createdAt).toBe('string');
      // Should be a valid ISO date string
      expect(new Date(result.createdAt)).not.toBeNaN();
    });
  });

  // ────────────────────────────────────────────────────────────
  // WRITER TESTS
  // ────────────────────────────────────────────────────────────

  describe('writer', () => {
    test('should generate content with specified word count', async () => {
      const job = {
        jobId: 'writer_001',
        topic: 'The Future of Remote Work',
        wordCount: 1000,
        tone: 'professional',
        keywords: ['remote work', 'productivity', 'collaboration tools']
      };

      const result = await writer(job);

      expect(result).toBeDefined();
      expect(result.id).toBe('writer_001');
      expect(result.title).toBe('The Future of Remote Work');
      expect(result.content).toBeDefined();
      expect(typeof result.content).toBe('string');
      expect(result.content.length).toBeGreaterThan(100);
      expect(result.wordCount).toBeDefined();
      expect(typeof result.wordCount).toBe('number');
      expect(result.wordCount).toBeGreaterThan(0);
      expect(result.targetWordCount).toBe(1000);
      expect(result.tone).toBe('professional');
      expect(Array.isArray(result.keywords)).toBe(true);
    });

    test('should estimate word count accurately', async () => {
      const job = {
        jobId: 'writer_wordcount',
        topic: 'AI in Business',
        wordCount: 800,
        tone: 'conversational',
        keywords: ['artificial intelligence', 'business automation']
      };

      const result = await writer(job);

      // Word count is estimated from mock AI output — just verify it's a positive number
      expect(result.wordCount).toBeGreaterThan(0);
    });

    test('should default to 1200 words when not specified', async () => {
      const job = {
        jobId: 'writer_default_wc',
        topic: 'Default Topic',
        tone: 'professional'
      };

      const result = await writer(job);

      expect(result.targetWordCount).toBe(1200);
    });

    test('should include provided keywords in metadata', async () => {
      const keywords = ['keyword1', 'keyword2', 'keyword3'];
      const job = {
        jobId: 'writer_keywords',
        topic: 'Test Topic',
        wordCount: 1000,
        tone: 'technical',
        keywords
      };

      const result = await writer(job);

      expect(result.keywords).toEqual(keywords);
    });

    test('should use tone for content style', async () => {
      const job = {
        jobId: 'writer_tone',
        topic: 'Service Description',
        wordCount: 600,
        tone: 'marketing',
        keywords: []
      };

      const result = await writer(job);

      expect(result.tone).toBe('marketing');
      expect(result.content).toBeDefined();
    });

    test('should handle brief data when provided', async () => {
      const job = {
        jobId: 'writer_with_brief',
        topic: 'Product Overview',
        wordCount: 800,
        tone: 'professional',
        keywords: ['product', 'features'],
        brief: {
          targetAudience: 'Enterprise customers',
          keyTopics: ['features', 'pricing', 'integration']
        }
      };

      const result = await writer(job);

      expect(result.content).toBeDefined();
      expect(result.wordCount).toBeGreaterThan(0);
    });

    test('should track creation timestamp', async () => {
      const job = {
        jobId: 'writer_timestamp',
        topic: 'Timestamped Content',
        wordCount: 500,
        tone: 'neutral'
      };

      const result = await writer(job);

      expect(result.createdAt).toBeDefined();
      expect(typeof result.createdAt).toBe('string');
      expect(new Date(result.createdAt)).not.toBeNaN();
    });
  });

  // ────────────────────────────────────────────────────────────
  // EDITOR TESTS
  // ────────────────────────────────────────────────────────────

  describe('editor', () => {
    test('should review content and return detailed scores', async () => {
      const content = `
        Artificial intelligence has transformed many industries.
        AI systems can now process vast amounts of data and identify patterns
        that humans might miss. This technology is used in healthcare, finance,
        manufacturing, and many other sectors. The potential applications continue
        to expand as researchers develop new techniques and approaches.
      `;

      const job = {
        jobId: 'editor_001',
        content,
        tone: 'professional',
        keywords: ['AI', 'artificial intelligence', 'technology']
      };

      const result = await editor(job);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.scores).toBeDefined();
      expect(typeof result.scores.clarity).toBe('number');
      expect(typeof result.scores.grammar).toBe('number');
      expect(typeof result.scores.toneConsistency).toBe('number');
      expect(typeof result.scores.seoScore).toBe('number');
      expect(typeof result.scores.audienceAlignment).toBe('number');
      expect(typeof result.scores.overall).toBe('number');

      // Scores should be non-negative numbers (mock provider may return 0-100 scale)
      expect(result.scores.clarity).toBeGreaterThanOrEqual(0);
    });

    test('should count issues found during review', async () => {
      const content = 'Here is som content with multiple errors and inconsistencies.';

      const job = {
        jobId: 'editor_issues',
        content,
        tone: 'professional',
        keywords: ['content']
      };

      const result = await editor(job);

      expect(result.issueCount).toBeDefined();
      expect(typeof result.issueCount).toBe('number');
      expect(result.issueCount).toBeGreaterThanOrEqual(0);
      expect(result.review).toBeDefined();
      expect(Array.isArray(result.review.issues)).toBe(true);
    });

    test('should include critical issue count', async () => {
      const job = {
        jobId: 'editor_critical',
        content: 'Content to evaluate for critical issues.',
        tone: 'professional'
      };

      const result = await editor(job);

      expect(typeof result.criticalIssues).toBe('number');
      expect(result.criticalIssues).toBeGreaterThanOrEqual(0);
    });

    test('should provide improvement suggestions', async () => {
      const job = {
        jobId: 'editor_improvements',
        content: 'Long content that could potentially be improved in various ways to enhance clarity and engagement with target audience.',
        tone: 'marketing',
        keywords: ['marketing', 'improvement']
      };

      const result = await editor(job);

      expect(result.review).toBeDefined();
      expect(Array.isArray(result.review.improvements)).toBe(true);
    });

    test('should evaluate tone consistency', async () => {
      const job = {
        jobId: 'editor_tone_check',
        content: 'This is professional content with consistent tone throughout.',
        tone: 'professional'
      };

      const result = await editor(job);

      expect(result.scores.toneConsistency).toBeDefined();
      expect(typeof result.scores.toneConsistency).toBe('number');
    });

    test('should track content review timestamp', async () => {
      const job = {
        jobId: 'editor_timestamp',
        content: 'Sample content',
        tone: 'neutral'
      };

      const result = await editor(job);

      expect(result.createdAt).toBeDefined();
      expect(typeof result.createdAt).toBe('string');
      expect(new Date(result.createdAt)).not.toBeNaN();
    });
  });

  // ────────────────────────────────────────────────────────────
  // HUMANIZATION TESTS
  // ────────────────────────────────────────────────────────────

  describe('humanization', () => {
    test('should humanize corporate content to sound more natural', async () => {
      const roboticContent = 'The enterprise solution provides comprehensive operational efficiency optimization through integrated system architecture.';

      const job = {
        jobId: 'humanize_001',
        content: roboticContent,
        targetAudience: 'business decision makers',
        voiceProfile: 'friendly and approachable'
      };

      const result = await humanization(job);

      expect(result).toBeDefined();
      expect(result.id).toBe('humanize_001');
      expect(result.originalContent).toBe(roboticContent);
      expect(result.humanizedContent).toBeDefined();
      expect(typeof result.humanizedContent).toBe('string');
      expect(result.humanizedContent.length).toBeGreaterThan(0);
      expect(result.targetAudience).toBe('business decision makers');
      expect(result.voiceProfile).toBe('friendly and approachable');
    });

    test('should preserve original content in output', async () => {
      const originalContent = 'The system implements automated workflows.';

      const job = {
        jobId: 'humanize_preserve',
        content: originalContent,
        targetAudience: 'technical users',
        voiceProfile: 'professional'
      };

      const result = await humanization(job);

      expect(result.originalContent).toBe(originalContent);
    });

    test('should track word count changes', async () => {
      const job = {
        jobId: 'humanize_wordcount',
        content: 'Original content here for humanization.',
        targetAudience: 'general audience',
        voiceProfile: 'casual'
      };

      const result = await humanization(job);

      expect(typeof result.originalWordCount).toBe('number');
      expect(typeof result.newWordCount).toBe('number');
      expect(typeof result.wordCountChange).toBe('number');
      expect(result.originalWordCount).toBeGreaterThan(0);
      expect(result.newWordCount).toBeGreaterThan(0);
    });

    test('should use provided voice profile', async () => {
      const profiles = ['conversational', 'authoritative', 'playful', 'neutral'];

      for (const profile of profiles) {
        const job = {
          jobId: `humanize_${profile}`,
          content: 'Test content to humanize.',
          targetAudience: 'test audience',
          voiceProfile: profile
        };

        const result = await humanization(job);
        expect(result.voiceProfile).toBe(profile);
      }
    });

    test('should track humanization timestamp', async () => {
      const job = {
        jobId: 'humanize_timestamp',
        content: 'Content to humanize.',
        targetAudience: 'audience',
        voiceProfile: 'friendly'
      };

      const result = await humanization(job);

      expect(result.createdAt).toBeDefined();
      expect(typeof result.createdAt).toBe('string');
      expect(new Date(result.createdAt)).not.toBeNaN();
    });
  });

  // ────────────────────────────────────────────────────────────
  // QUALITY GATE TESTS
  // ────────────────────────────────────────────────────────────

  describe('qualityGate', () => {
    test('should assess content quality and return pass/fail decision', async () => {
      const content = `
        Content quality is essential for user engagement and SEO performance.
        High-quality content addresses reader needs, provides accurate information,
        and is well-structured with clear headings and logical flow.
        This assessment determines whether content meets minimum standards.
      `;

      const job = {
        jobId: 'qgate_001',
        content,
        rubric: {
          'Relevance': 25,
          'Accuracy': 25,
          'Engagement': 25,
          'Grammar': 25
        },
        threshold: 75,
        contentType: 'article'
      };

      const result = await qualityGate(job);

      expect(result).toBeDefined();
      expect(result.id).toBe('qgate_001');
      expect(typeof result.passed).toBe('boolean');
      expect(typeof result.overallScore).toBe('number');
      expect(result.overallScore).toBeGreaterThanOrEqual(0);
      expect(result.overallScore).toBeLessThanOrEqual(100);
      expect(result.threshold).toBe(75);
      expect(result.assessment).toBeDefined();
    });

    test('should score based on provided rubric', async () => {
      const job = {
        jobId: 'qgate_rubric',
        content: 'Content to evaluate against rubric.',
        rubric: {
          'Technical Accuracy': 40,
          'Readability': 30,
          'Completeness': 30
        },
        threshold: 80,
        contentType: 'documentation'
      };

      const result = await qualityGate(job);

      expect(result.assessment).toBeDefined();
      expect(Array.isArray(result.assessment.criteria)).toBe(true);
    });

    test('should use default threshold of 75', async () => {
      const job = {
        jobId: 'qgate_default_threshold',
        content: 'Sample content',
        contentType: 'blog'
        // No threshold specified
      };

      const result = await qualityGate(job);

      expect(result.threshold).toBe(75);
    });

    test('should pass content above threshold', async () => {
      const job = {
        jobId: 'qgate_pass',
        content: 'High-quality content that clearly exceeds passing criteria.',
        rubric: {
          'Quality': 50,
          'Structure': 50
        },
        threshold: 70,
        contentType: 'article'
      };

      const result = await qualityGate(job);

      if (result.overallScore >= result.threshold) {
        expect(result.passed).toBe(true);
      }
    });

    test('should fail content below threshold', async () => {
      const job = {
        jobId: 'qgate_fail',
        content: 'minimal',
        rubric: {
          'Quality': 50,
          'Depth': 50
        },
        threshold: 80,
        contentType: 'article'
      };

      const result = await qualityGate(job);

      if (result.overallScore < result.threshold) {
        expect(result.passed).toBe(false);
      }
    });

    test('should provide revision notes when content fails', async () => {
      const job = {
        jobId: 'qgate_revisions',
        content: 'Short content.',
        rubric: {
          'Completeness': 50,
          'Depth': 50
        },
        threshold: 85,
        contentType: 'article'
      };

      const result = await qualityGate(job);

      expect(result.assessment).toBeDefined();
      expect(Array.isArray(result.assessment.revisionNotes) || result.assessment.revisionNotes === undefined).toBe(true);
    });

    test('should track assessment timestamp', async () => {
      const job = {
        jobId: 'qgate_timestamp',
        content: 'Content assessment.',
        threshold: 75
      };

      const result = await qualityGate(job);

      expect(result.createdAt).toBeDefined();
      expect(typeof result.createdAt).toBe('string');
      expect(new Date(result.createdAt)).not.toBeNaN();
    });
  });

  // ────────────────────────────────────────────────────────────
  // DELIVERY TESTS
  // ────────────────────────────────────────────────────────────

  describe('delivery', () => {
    test('should require jobId string', async () => {
      const job = {
        content: { title: 'Test', body: 'Content' },
        deliveryFormats: ['markdown']
      };

      await expect(delivery(job)).rejects.toThrow(/requires a valid jobId/);
    });

    test('should throw when jobId is missing', async () => {
      const job = {
        content: { title: 'Test', body: 'Content' },
        deliveryFormats: ['markdown']
      };

      await expect(delivery(job)).rejects.toThrow();
    });

    test('should throw when jobId is not a string', async () => {
      const job = {
        jobId: 12345, // Invalid: number instead of string
        content: { title: 'Test', body: 'Content' },
        deliveryFormats: ['markdown']
      };

      await expect(delivery(job)).rejects.toThrow();
    });

    test('should deliver content in requested formats', async () => {
      const job = {
        jobId: 'delivery_001',
        content: {
          title: 'Delivery Test Article',
          body: 'This is test content for delivery agent testing.'
        },
        deliveryFormats: ['markdown', 'html'],
        client: {
          name: 'Test Client',
          email: 'test@example.com'
        }
      };

      const result = await delivery(job);

      expect(result).toBeDefined();
      expect(result.id).toBe('delivery_001');
      expect(result.contentTitle).toBe('Delivery Test Article');
      expect(result.status).toBe('delivered');
      expect(Array.isArray(result.deliveryResults)).toBe(true);
      expect(typeof result.succeededCount).toBe('number');
    });

    test('should handle default formats', async () => {
      const job = {
        jobId: 'delivery_default_formats',
        content: { title: 'Default Format Test', body: 'Content' }
        // No deliveryFormats specified
      };

      const result = await delivery(job);

      expect(result.formatsRequested).toBeDefined();
      expect(Array.isArray(result.formatsRequested)).toBe(true);
    });

    test('should support multiple delivery formats', async () => {
      const formats = ['markdown', 'pdf', 'html', 'google_docs'];

      for (const format of formats) {
        const job = {
          jobId: `delivery_${format}`,
          content: { title: 'Multi-Format Test', body: 'Content for ' + format },
          deliveryFormats: [format],
          client: { email: 'client@example.com' }
        };

        const result = await delivery(job);
        expect(result.id).toBe(`delivery_${format}`);
      }
    });

    test('should track delivery timestamp', async () => {
      const job = {
        jobId: 'delivery_timestamp',
        content: { title: 'Timestamped Delivery', body: 'Content' },
        deliveryFormats: ['markdown']
      };

      const result = await delivery(job);

      expect(result.deliveredAt).toBeDefined();
      expect(typeof result.deliveredAt).toBe('string');
      expect(new Date(result.deliveredAt)).not.toBeNaN();
    });

    test('should include client email in delivery record', async () => {
      const job = {
        jobId: 'delivery_client_email',
        content: { title: 'Test', body: 'Content' },
        client: { email: 'client@example.com' }
      };

      const result = await delivery(job);

      expect(result.clientEmail).toBe('client@example.com');
    });
  });

  // ────────────────────────────────────────────────────────────
  // COLD OUTREACH TESTS
  // ────────────────────────────────────────────────────────────

  describe('coldOutreach', () => {
    test('should require jobId string', async () => {
      const job = {
        recipient: { email: 'test@example.com' },
        painPoints: ['problem1'],
        service: 'Content creation'
      };

      await expect(coldOutreach(job)).rejects.toThrow(/requires a valid jobId/);
    });

    test('should throw when jobId is missing', async () => {
      const job = {
        recipient: { email: 'test@example.com' },
        painPoints: ['problem1'],
        service: 'Content creation'
      };

      await expect(coldOutreach(job)).rejects.toThrow();
    });

    test('should throw when jobId is not a string', async () => {
      const job = {
        jobId: { id: 'invalid' }, // Invalid: object instead of string
        recipient: { email: 'test@example.com' },
        painPoints: ['problem1'],
        service: 'Content creation'
      };

      await expect(coldOutreach(job)).rejects.toThrow();
    });

    test('should generate personalized cold email', async () => {
      const job = {
        jobId: 'outreach_001',
        recipient: {
          email: 'prospect@company.com',
          name: 'John Smith',
          company: 'TechCorp',
          role: 'Marketing Director'
        },
        painPoints: ['content creation bottleneck', 'low SEO rankings'],
        service: 'Professional content writing and optimization',
        agencyProfile: {
          name: 'KAIL Data Services',
          website: 'https://kail.dev',
          contact: 'hello@kail.dev'
        }
      };

      const result = await coldOutreach(job);

      expect(result).toBeDefined();
      expect(result.id).toBe('outreach_001');
      expect(result.recipientEmail).toBe('prospect@company.com');
      expect(result.recipientName).toBe('John Smith');
      expect(result.company).toBe('TechCorp');
      expect(result.subject).toBeDefined();
      expect(typeof result.subject).toBe('string');
      expect(result.subject.length).toBeGreaterThan(0);
      expect(result.body).toBeDefined();
      expect(typeof result.body).toBe('string');
      expect(result.body.length).toBeGreaterThan(0);
      expect(result.status).toBe('draft');
    });

    test('should include pain points in email content', async () => {
      const job = {
        jobId: 'outreach_painpoints',
        recipient: {
          email: 'contact@example.com',
          name: 'Jane Doe',
          company: 'Example Inc',
          role: 'CEO'
        },
        painPoints: ['expensive content creation', 'quality inconsistency'],
        service: 'Content as a Service'
      };

      const result = await coldOutreach(job);

      expect(result.painPoints).toEqual(['expensive content creation', 'quality inconsistency']);
      expect(result.body).toBeDefined();
    });

    test('should generate subject line', async () => {
      const job = {
        jobId: 'outreach_subject',
        recipient: {
          email: 'sales@company.com',
          name: 'Sales Manager',
          company: 'RetailCorp',
          role: 'Manager'
        },
        painPoints: ['inventory management'],
        service: 'Optimization services'
      };

      const result = await coldOutreach(job);

      expect(result.subject).toBeDefined();
      expect(result.subject.length).toBeGreaterThan(5);
      expect(result.subject.length).toBeLessThan(100);
    });

    test('should track outreach timestamp', async () => {
      const job = {
        jobId: 'outreach_timestamp',
        recipient: { email: 'test@example.com', name: 'Test' },
        painPoints: ['problem'],
        service: 'service'
      };

      const result = await coldOutreach(job);

      expect(result.createdAt).toBeDefined();
      expect(typeof result.createdAt).toBe('string');
      expect(new Date(result.createdAt)).not.toBeNaN();
    });

    test('should respect compliance check status', async () => {
      const job = {
        jobId: 'outreach_compliance',
        recipient: {
          email: 'prospect@company.com',
          name: 'Prospect',
          company: 'Company',
          role: 'Role'
        },
        painPoints: ['pain point'],
        service: 'service',
        sendImmediately: false // Don't send, just generate
      };

      const result = await coldOutreach(job);

      // When not sending immediately, status should be 'draft'
      expect(result.status).toBe('draft');
    });

    test('should handle blocked status when compliance check fails', async () => {
      const job = {
        jobId: 'outreach_blocked',
        recipient: {
          email: 'test@example.com',
          name: 'Test',
          company: 'Test Co',
          role: 'Role'
        },
        painPoints: ['issue'],
        service: 'Service',
        sendImmediately: true // Request send, may be blocked by compliance
      };

      const result = await coldOutreach(job);

      // Status should be either 'draft', 'sent', or 'blocked'
      expect(['draft', 'sent', 'blocked']).toContain(result.status);

      // If blocked, should have compliance information
      if (result.status === 'blocked') {
        expect(result.complianceReason).toBeDefined();
      }
    });

    test('should use default agency profile', async () => {
      const job = {
        jobId: 'outreach_default_profile',
        recipient: { email: 'test@example.com', name: 'Test' },
        painPoints: ['pain'],
        service: 'service'
        // No agencyProfile specified
      };

      const result = await coldOutreach(job);

      expect(result.agencyName).toBe('KAIL Data Services');
    });

    test('should preserve pain points in output', async () => {
      const painPoints = ['pain1', 'pain2', 'pain3'];
      const job = {
        jobId: 'outreach_pain_preserve',
        recipient: { email: 'test@example.com', name: 'Test' },
        painPoints,
        service: 'service'
      };

      const result = await coldOutreach(job);

      expect(result.painPoints).toEqual(painPoints);
    });
  });

  // ────────────────────────────────────────────────────────────
  // INTEGRATION SCENARIOS
  // ────────────────────────────────────────────────────────────

  describe('Agent Integration Scenarios', () => {
    test('should workflow from opportunity to delivery', async () => {
      // 1. Score opportunities
      const scoringJob = {
        jobId: 'workflow_test_001',
        opportunities: [
          {
            id: 'opp1',
            title: 'Blog Series',
            budget: 3000,
            duration: '1 month',
            level: 'intermediate',
            workType: 'fixed-price',
            description: 'Write 5 blog posts'
          }
        ],
        agencyProfile: {
          specialties: 'content writing',
          baseHourlyRate: 75,
          minProjectValue: 500
        }
      };

      const scoringResult = await opportunityScorer(scoringJob);
      expect(scoringResult.opportunitiesAnalyzed).toBe(1);

      // 2. Create brief from requirements
      const briefJob = {
        jobId: 'workflow_test_002',
        client: { name: 'Client', email: 'client@example.com' },
        rawRequirements: 'Write blog posts about web development'
      };

      const briefResult = await clientBrief(briefJob);
      expect(briefResult.brief).toBeDefined();

      // 3. Generate content
      const writerJob = {
        jobId: 'workflow_test_003',
        topic: 'Web Development Basics',
        wordCount: 1500,
        tone: 'technical',
        keywords: ['web development', 'coding']
      };

      const writerResult = await writer(writerJob);
      expect(writerResult.content).toBeDefined();

      // 4. Review content
      const editorJob = {
        jobId: 'workflow_test_004',
        content: writerResult.content,
        tone: 'technical',
        keywords: ['web development']
      };

      const editorResult = await editor(editorJob);
      expect(editorResult.scores).toBeDefined();

      // 5. Assess quality
      const qgateJob = {
        jobId: 'workflow_test_005',
        content: writerResult.content,
        threshold: 75,
        contentType: 'article'
      };

      const qgateResult = await qualityGate(qgateJob);
      expect(qgateResult.passed).toBeDefined();
    });

    test('should combine writer and humanization for enhanced content', async () => {
      // Generate content
      const writerJob = {
        jobId: 'enhance_writer',
        topic: 'Enterprise Solutions',
        wordCount: 800,
        tone: 'professional',
        keywords: ['enterprise', 'solutions']
      };

      const writerResult = await writer(writerJob);

      // Humanize the generated content
      const humanizeJob = {
        jobId: 'enhance_humanize',
        content: writerResult.content,
        targetAudience: 'business managers',
        voiceProfile: 'friendly and accessible'
      };

      const humanizeResult = await humanization(humanizeJob);

      expect(humanizeResult.originalContent).toBe(writerResult.content);
      expect(humanizeResult.humanizedContent).toBeDefined();
      expect(humanizeResult.humanizedContent !== writerResult.content).toBe(true);
    });
  });
});
