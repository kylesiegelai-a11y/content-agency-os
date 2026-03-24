process.env.MOCK_MODE = 'true';
process.env.NODE_ENV = 'test';

const {
  OPPORTUNITY_STATUSES,
  SOURCE_TYPES,
  createOpportunity,
  validateOpportunity
} = require('../../acquisition/opportunitySchema');

const AcquisitionSource = require('../../acquisition/AcquisitionSource');
const SourceRegistry = require('../../acquisition/SourceRegistry');

const {
  scoreOpportunity,
  qualifyOpportunities,
  _scoreContentFit,
  _scoreBudgetFit,
  _scoreServiceFit,
  _scoreUrgency,
  _scoreCompleteness,
  _scoreConfidence
} = require('../../acquisition/scoring');

const {
  generateDedupeKey,
  computeSimilarity,
  dedupeOpportunities
} = require('../../acquisition/dedupe');

describe('Acquisition Core Module Tests', () => {

  // ========== OPPORTUNITY SCHEMA TESTS ==========
  describe('opportunitySchema', () => {

    describe('createOpportunity', () => {
      it('should create opportunity with defaults', () => {
        const opp = createOpportunity();
        expect(opp.id).toBeDefined();
        expect(opp.source_type).toBeNull();
        expect(opp.title).toBe('');
        expect(opp.status).toBe(OPPORTUNITY_STATUSES.NEW);
        expect(opp.currency).toBe('USD');
        expect(opp.tags).toEqual([]);
        expect(opp.metadata).toEqual({});
      });

      it('should create opportunity with all fields provided', () => {
        const fields = {
          id: 'test-123',
          source_type: SOURCE_TYPES.FORM,
          source_name: 'contact_form',
          source_record_id: 'rec-456',
          title: 'Website redesign project',
          description: 'Full website redesign',
          client_name: 'John Doe',
          client_email: 'john@example.com',
          company_name: 'ACME Corp',
          budget_min: 5000,
          budget_max: 10000,
          currency: 'EUR',
          timeline: '2 weeks',
          location: 'New York',
          tags: ['urgent', 'web'],
          confidence_score: 0.95
        };
        const opp = createOpportunity(fields);
        expect(opp.id).toBe('test-123');
        expect(opp.source_type).toBe(SOURCE_TYPES.FORM);
        expect(opp.title).toBe('Website redesign project');
        expect(opp.budget_min).toBe(5000);
        expect(opp.budget_max).toBe(10000);
        expect(opp.tags).toEqual(['urgent', 'web']);
        expect(opp.confidence_score).toBe(0.95);
      });

      it('should generate timestamps automatically', () => {
        const opp = createOpportunity();
        expect(opp.created_at).toBeDefined();
        expect(opp.updated_at).toBeDefined();
        expect(opp.received_at).toBeDefined();
      });

      it('should handle null budget values', () => {
        const opp = createOpportunity({ budget_min: 100, budget_max: null });
        expect(opp.budget_min).toBe(100);
        expect(opp.budget_max).toBeNull();
      });
    });

    describe('validateOpportunity', () => {
      it('should validate a valid opportunity', () => {
        const opp = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'contact_form',
          title: 'Project title',
          client_email: 'john@example.com'
        });
        const result = validateOpportunity(opp);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
      });

      it('should fail validation when source_type is missing', () => {
        const opp = createOpportunity({ source_type: null, source_name: 'form' });
        const result = validateOpportunity(opp);
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual(expect.stringContaining('source_type'));
      });

      it('should fail validation when source_type is invalid', () => {
        const opp = createOpportunity({ source_type: 'invalid_type', source_name: 'form' });
        const result = validateOpportunity(opp);
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual(expect.stringContaining('source_type'));
      });

      it('should fail validation when title is missing', () => {
        const opp = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: ''
        });
        const result = validateOpportunity(opp);
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual(expect.stringContaining('title'));
      });

      it('should fail validation when title is only whitespace', () => {
        const opp = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: '   '
        });
        const result = validateOpportunity(opp);
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual(expect.stringContaining('title'));
      });

      it('should fail validation when budget_min is negative', () => {
        const opp = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Project',
          budget_min: -100
        });
        const result = validateOpportunity(opp);
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual(expect.stringContaining('budget_min'));
      });

      it('should fail validation when budget_min exceeds budget_max', () => {
        const opp = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Project',
          budget_min: 10000,
          budget_max: 5000
        });
        const result = validateOpportunity(opp);
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual(expect.stringContaining('budget_min'));
      });

      it('should fail validation for invalid email format', () => {
        const opp = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Project',
          client_email: 'invalid-email'
        });
        const result = validateOpportunity(opp);
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual(expect.stringContaining('email'));
      });

      it('should accept valid email format', () => {
        const opp = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Project',
          client_email: 'test@example.com'
        });
        const result = validateOpportunity(opp);
        expect(result.errors).not.toContainEqual(expect.stringContaining('email'));
      });
    });

    describe('OPPORTUNITY_STATUSES', () => {
      it('should have all expected status values', () => {
        const expectedStatuses = [
          'new', 'normalized', 'scored', 'needs_review', 'qualified',
          'rejected', 'imported', 'source_error', 'duplicate'
        ];
        for (const status of expectedStatuses) {
          expect(Object.values(OPPORTUNITY_STATUSES)).toContain(status);
        }
      });
    });

    describe('SOURCE_TYPES', () => {
      it('should have all expected source types', () => {
        const expectedTypes = ['form', 'gmail', 'csv_import', 'referral', 'marketplace', 'manual'];
        for (const type of expectedTypes) {
          expect(Object.values(SOURCE_TYPES)).toContain(type);
        }
      });
    });
  });

  // ========== ACQUISITION SOURCE TESTS ==========
  describe('AcquisitionSource', () => {

    it('should not allow direct instantiation of abstract class', () => {
      expect(() => {
        new AcquisitionSource('test', SOURCE_TYPES.FORM);
      }).toThrow('abstract');
    });

    it('should allow subclass instantiation', () => {
      class ConcreteSource extends AcquisitionSource {
        async fetchOpportunities() { return []; }
        normalizeOpportunity(raw) { return raw; }
      }
      const source = new ConcreteSource('test-source', SOURCE_TYPES.FORM);
      expect(source.name).toBe('test-source');
      expect(source.sourceType).toBe(SOURCE_TYPES.FORM);
      expect(source.enabled).toBe(true);
    });

    it('should throw when fetchOpportunities is not overridden', async () => {
      class IncompleteSource extends AcquisitionSource {
        normalizeOpportunity(raw) { return raw; }
      }
      const source = new IncompleteSource('test', SOURCE_TYPES.FORM);
      await expect(source.fetchOpportunities()).rejects.toThrow('fetchOpportunities');
    });

    it('should throw when normalizeOpportunity is not overridden', () => {
      class IncompleteSource extends AcquisitionSource {
        async fetchOpportunities() { return []; }
      }
      const source = new IncompleteSource('test', SOURCE_TYPES.FORM);
      expect(() => source.normalizeOpportunity({})).toThrow('normalizeOpportunity');
    });

    it('should reject null payload in validatePayload', () => {
      class ConcreteSource extends AcquisitionSource {
        async fetchOpportunities() { return []; }
        normalizeOpportunity(raw) { return raw; }
      }
      const source = new ConcreteSource('test', SOURCE_TYPES.FORM);
      const result = source.validatePayload(null);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('Payload'));
    });

    it('should accept valid object in validatePayload', () => {
      class ConcreteSource extends AcquisitionSource {
        async fetchOpportunities() { return []; }
        normalizeOpportunity(raw) { return raw; }
      }
      const source = new ConcreteSource('test', SOURCE_TYPES.FORM);
      const result = source.validatePayload({ data: 'test' });
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should return correct status structure', () => {
      class ConcreteSource extends AcquisitionSource {
        async fetchOpportunities() { return []; }
        normalizeOpportunity(raw) { return raw; }
      }
      const source = new ConcreteSource('test-source', SOURCE_TYPES.FORM);
      const status = source.getStatus();
      expect(status).toEqual(expect.objectContaining({
        name: 'test-source',
        sourceType: SOURCE_TYPES.FORM,
        enabled: true,
        healthy: true,
        stats: expect.any(Object)
      }));
    });

    it('should update status on _recordError', () => {
      class ConcreteSource extends AcquisitionSource {
        async fetchOpportunities() { return []; }
        normalizeOpportunity(raw) { return raw; }
      }
      const source = new ConcreteSource('test', SOURCE_TYPES.FORM);
      source._recordError(new Error('Test error'));
      const status = source.getStatus();
      expect(status.healthy).toBe(false);
      expect(status.lastError).toBeDefined();
      expect(status.stats.errors).toBe(1);
    });

    it('should update status on _recordSuccess', () => {
      class ConcreteSource extends AcquisitionSource {
        async fetchOpportunities() { return []; }
        normalizeOpportunity(raw) { return raw; }
      }
      const source = new ConcreteSource('test', SOURCE_TYPES.FORM);
      source._recordSuccess(5);
      const status = source.getStatus();
      expect(status.healthy).toBe(true);
      expect(status.lastError).toBeNull();
      expect(status.stats.ingested).toBe(5);
      expect(status.stats.lastRunAt).toBeDefined();
    });
  });

  // ========== SOURCE REGISTRY TESTS ==========
  describe('SourceRegistry', () => {

    it('should register and retrieve a source', () => {
      class TestSource extends AcquisitionSource {
        async fetchOpportunities() { return []; }
        normalizeOpportunity(raw) { return raw; }
      }
      const registry = new SourceRegistry({ mockMode: true });
      const source = new TestSource('test-src', SOURCE_TYPES.FORM);
      registry.register(source);
      expect(registry.getSource('test-src')).toBe(source);
    });

    it('should return only enabled sources from getActiveSources', () => {
      class TestSource extends AcquisitionSource {
        async fetchOpportunities() { return []; }
        normalizeOpportunity(raw) { return raw; }
      }
      const registry = new SourceRegistry({ mockMode: true });
      const source1 = new TestSource('enabled-src', SOURCE_TYPES.FORM);
      const source2 = new TestSource('disabled-src', SOURCE_TYPES.GMAIL, { enabled: false });
      registry.register(source1);
      registry.register(source2);
      const active = registry.getActiveSources();
      expect(active).toHaveLength(1);
      expect(active[0].name).toBe('enabled-src');
    });

    it('should exclude disabled sources from getActiveSources', () => {
      class TestSource extends AcquisitionSource {
        async fetchOpportunities() { return []; }
        normalizeOpportunity(raw) { return raw; }
      }
      const registry = new SourceRegistry({ mockMode: true });
      const source = new TestSource('test', SOURCE_TYPES.FORM, { enabled: false });
      registry.register(source);
      const active = registry.getActiveSources();
      expect(active).toHaveLength(0);
    });

    it('should exclude mock-only sources in production mode', () => {
      class TestSource extends AcquisitionSource {
        async fetchOpportunities() { return []; }
        normalizeOpportunity(raw) { return raw; }
      }
      const registry = new SourceRegistry({ mockMode: false, strictProduction: true });
      const source = new TestSource('mock-src', SOURCE_TYPES.FORM);
      const result = registry.register(source, { mockOnly: true });
      expect(result.registered).toBe(false);
      expect(result.reason).toBe('mock_only_in_production');
    });

    it('should allow mock-only source registration in mock mode', () => {
      class TestSource extends AcquisitionSource {
        async fetchOpportunities() { return []; }
        normalizeOpportunity(raw) { return raw; }
      }
      const registry = new SourceRegistry({ mockMode: true });
      const source = new TestSource('mock-src', SOURCE_TYPES.FORM);
      const result = registry.register(source, { mockOnly: true });
      expect(result.registered).toBe(true);
      const active = registry.getActiveSources();
      expect(active).toContainEqual(expect.objectContaining({ name: 'mock-src' }));
    });

    it('should refuse mock-only source in strict production mode', () => {
      class TestSource extends AcquisitionSource {
        async fetchOpportunities() { return []; }
        normalizeOpportunity(raw) { return raw; }
      }
      const registry = new SourceRegistry({ mockMode: false, strictProduction: true });
      const source = new TestSource('mock-src', SOURCE_TYPES.FORM);
      const result = registry.register(source, { mockOnly: true });
      expect(result.registered).toBe(false);
    });

    it('should return source statuses with metadata', () => {
      class TestSource extends AcquisitionSource {
        async fetchOpportunities() { return []; }
        normalizeOpportunity(raw) { return raw; }
      }
      const registry = new SourceRegistry({ mockMode: true });
      const source = new TestSource('test-src', SOURCE_TYPES.FORM);
      registry.register(source, { mockOnly: true });
      const statuses = registry.getSourceStatuses();
      expect(statuses).toHaveLength(1);
      expect(statuses[0]).toEqual(expect.objectContaining({
        name: 'test-src',
        mockOnly: true,
        activeInCurrentMode: true
      }));
    });

    it('should fetch opportunities from multiple sources', async () => {
      class TestSource extends AcquisitionSource {
        async fetchOpportunities() {
          return [{
            title: 'Opportunity from ' + this.name,
            description: 'Test'
          }];
        }
        normalizeOpportunity(raw) {
          return createOpportunity({
            ...raw,
            source_name: this.name,
            source_type: this.sourceType
          });
        }
      }
      const registry = new SourceRegistry({ mockMode: true });
      const source1 = new TestSource('source-1', SOURCE_TYPES.FORM);
      const source2 = new TestSource('source-2', SOURCE_TYPES.GMAIL);
      registry.register(source1);
      registry.register(source2);
      const result = await registry.fetchAllOpportunities();
      expect(result.opportunities).toHaveLength(2);
      expect(result.sourceResults).toHaveLength(2);
    });

    it('should handle fetch errors gracefully', async () => {
      class FailingSource extends AcquisitionSource {
        async fetchOpportunities() {
          throw new Error('Fetch failed');
        }
        normalizeOpportunity(raw) { return raw; }
      }
      const registry = new SourceRegistry({ mockMode: true });
      const source = new FailingSource('failing-src', SOURCE_TYPES.FORM);
      registry.register(source);
      const result = await registry.fetchAllOpportunities();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe('fetch_error');
    });

    it('should handle normalization errors gracefully', async () => {
      class BadNormSource extends AcquisitionSource {
        async fetchOpportunities() {
          return [{ data: 'test' }];
        }
        normalizeOpportunity(raw) {
          throw new Error('Normalization failed');
        }
      }
      const registry = new SourceRegistry({ mockMode: true });
      const source = new BadNormSource('bad-src', SOURCE_TYPES.FORM);
      registry.register(source);
      const result = await registry.fetchAllOpportunities();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe('normalization_error');
    });

    it('should return empty results with no active sources', async () => {
      const registry = new SourceRegistry({ mockMode: true });
      const result = await registry.fetchAllOpportunities();
      expect(result.opportunities).toEqual([]);
      expect(result.errors).toEqual([]);
      expect(result.sourceResults).toEqual([]);
    });

    it('should return correct active source count', () => {
      class TestSource extends AcquisitionSource {
        async fetchOpportunities() { return []; }
        normalizeOpportunity(raw) { return raw; }
      }
      const registry = new SourceRegistry({ mockMode: true });
      registry.register(new TestSource('src1', SOURCE_TYPES.FORM));
      registry.register(new TestSource('src2', SOURCE_TYPES.FORM));
      registry.register(new TestSource('src3', SOURCE_TYPES.FORM, { enabled: false }));
      expect(registry.getActiveSourceCount()).toBe(2);
    });

    it('should reflect mock mode correctly', () => {
      const mockRegistry = new SourceRegistry({ mockMode: true });
      const prodRegistry = new SourceRegistry({ mockMode: false });
      expect(mockRegistry.isMockMode()).toBe(true);
      expect(prodRegistry.isMockMode()).toBe(false);
    });
  });

  // ========== SCORING TESTS ==========
  describe('scoring', () => {

    describe('scoreOpportunity', () => {
      it('should return score, breakdown, reasons, and status', () => {
        const opp = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'PEO blog post for SaaS company',
          description: 'Comprehensive blog article about PEO benefits'
        });
        const result = scoreOpportunity(opp);
        expect(result).toEqual(expect.objectContaining({
          score: expect.any(Number),
          breakdown: expect.any(Object),
          reasons: expect.any(Array),
          status: expect.stringMatching(/qualified|needs_review|rejected/)
        }));
      });

      it('should give QUALIFIED status for high-scoring opportunity', () => {
        const opp = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Blog posts about HR and benefits compliance',
          description: 'Content about SaaS compliance tools',
          budget_min: 5000,
          budget_max: 15000,
          client_email: 'test@example.com',
          tags: ['urgent', 'HR', 'content writing']
        });
        const result = scoreOpportunity(opp);
        expect(result.status).toBe(OPPORTUNITY_STATUSES.QUALIFIED);
        expect(result.score).toBeGreaterThanOrEqual(65);
      });

      it('should give REJECTED status for low-scoring opportunity', () => {
        const opp = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Unrelated project'
        });
        const result = scoreOpportunity(opp);
        expect(result.status).toBe(OPPORTUNITY_STATUSES.REJECTED);
        expect(result.score).toBeLessThan(40);
      });

      it('should give NEEDS_REVIEW status for mid-scoring opportunity', () => {
        const opp = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Blog article',
          description: 'Some content about HR',
          budget_min: 1000,
          budget_max: 2000
        });
        const result = scoreOpportunity(opp);
        expect(result.status).toBe(OPPORTUNITY_STATUSES.NEEDS_REVIEW);
        expect(result.score).toBeGreaterThanOrEqual(40);
        expect(result.score).toBeLessThan(65);
      });
    });

    describe('_scoreContentFit', () => {
      it('should match target niches', () => {
        const opp = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'HR and benefits content',
          description: 'PEO SaaS article'
        });
        const result = _scoreContentFit(opp, { targetNiches: ['HR', 'PEO', 'SaaS'] });
        expect(result.score).toBeGreaterThanOrEqual(70);
        expect(result.matchedNiches.length).toBeGreaterThan(0);
      });

      it('should score low for non-matching content', () => {
        const opp = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Unrelated project'
        });
        const result = _scoreContentFit(opp, { targetNiches: ['HR', 'PEO', 'SaaS'] });
        expect(result.score).toBeLessThan(30);
      });
    });

    describe('_scoreBudgetFit', () => {
      it('should score high budget well', () => {
        const opp = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Project',
          budget_min: 10000,
          budget_max: 20000
        });
        const result = _scoreBudgetFit(opp, { minBudget: 500, idealBudget: 2000, maxBudget: 50000 });
        expect(result.score).toBeGreaterThanOrEqual(70);
      });

      it('should score zero budget low', () => {
        const opp = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Project'
        });
        const result = _scoreBudgetFit(opp, { minBudget: 500 });
        expect(result.score).toBe(30);
      });

      it('should score budget below minimum', () => {
        const opp = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Project',
          budget_max: 250
        });
        const result = _scoreBudgetFit(opp, { minBudget: 500 });
        expect(result.score).toBeLessThan(30);
      });

      it('should score budget between min and ideal', () => {
        const opp = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Project',
          budget_max: 1000
        });
        const result = _scoreBudgetFit(opp, { minBudget: 500, idealBudget: 2000 });
        expect(result.score).toBeGreaterThan(30);
        expect(result.score).toBeLessThan(70);
      });
    });

    describe('_scoreServiceFit', () => {
      it('should match target services', () => {
        const opp = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Blog posts and white papers',
          description: 'Need case studies and email campaigns'
        });
        const result = _scoreServiceFit(opp, {
          targetServices: ['blog posts', 'white papers', 'case studies', 'email campaigns']
        });
        expect(result.score).toBeGreaterThanOrEqual(70);
        expect(result.matchedServices.length).toBeGreaterThan(0);
      });
    });

    describe('_scoreUrgency', () => {
      it('should detect urgent keywords', () => {
        const opp = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'ASAP project - urgent deadline',
          description: 'We need this immediately'
        });
        const result = _scoreUrgency(opp);
        expect(result.score).toBeGreaterThanOrEqual(60);
        expect(result.signals).toContainEqual(expect.any(String));
      });

      it('should score based on timeline', () => {
        const opp = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Project',
          timeline: '1 week'
        });
        const result = _scoreUrgency(opp);
        expect(result.score).toBeGreaterThanOrEqual(60);
      });
    });

    describe('_scoreCompleteness', () => {
      it('should score high with all fields filled', () => {
        const opp = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Complete project',
          description: 'Full description',
          client_name: 'John Doe',
          client_email: 'john@example.com',
          company_name: 'ACME',
          budget_min: 1000,
          budget_max: 5000,
          timeline: '2 weeks',
          tags: ['urgent']
        });
        const result = _scoreCompleteness(opp);
        expect(result.score).toBeGreaterThanOrEqual(80);
      });

      it('should score low with few fields', () => {
        const opp = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Sparse project'
        });
        const result = _scoreCompleteness(opp);
        expect(result.score).toBeLessThan(50);
      });
    });

    describe('_scoreConfidence', () => {
      it('should use provided confidence score', () => {
        const opp = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Project',
          confidence_score: 0.85
        });
        const result = _scoreConfidence(opp);
        expect(result.score).toBe(85);
      });

      it('should use default confidence when not provided', () => {
        const opp = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Project'
        });
        const result = _scoreConfidence(opp);
        expect(result.score).toBe(60);
        expect(result.source).toBe('default');
      });
    });

    describe('qualifyOpportunities', () => {
      it('should return qualified, needsReview, and rejected batches', () => {
        const opps = [
          createOpportunity({
            source_type: SOURCE_TYPES.FORM,
            source_name: 'form',
            title: 'HR and benefits blog posts',
            description: 'Content about PEO SaaS',
            budget_min: 5000,
            budget_max: 15000,
            tags: ['content writing']
          }),
          createOpportunity({
            source_type: SOURCE_TYPES.FORM,
            source_name: 'form',
            title: 'Blog article',
            budget_max: 2000
          }),
          createOpportunity({
            source_type: SOURCE_TYPES.FORM,
            source_name: 'form',
            title: 'Unrelated project'
          })
        ];
        const result = qualifyOpportunities(opps);
        expect(result.qualified).toHaveLength(1);
        expect(result.needsReview).toHaveLength(1);
        expect(result.rejected).toHaveLength(1);
      });

      it('should apply custom config to override thresholds', () => {
        const opp = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'HR and benefits blog'
        });
        const result = qualifyOpportunities([opp], {
          qualificationThreshold: 20,
          reviewThreshold: 10
        });
        expect(result.qualified).toHaveLength(1);
      });

      it('should apply custom weights to change scoring', () => {
        const opp = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Project',
          budget_max: 20000
        });
        const result = qualifyOpportunities([opp], {
          weights: {
            contentFit: 0,
            budgetFit: 1.0,
            serviceFit: 0,
            urgency: 0,
            completeness: 0,
            confidence: 0
          }
        });
        expect(result.qualified).toHaveLength(1);
      });
    });
  });

  // ========== DEDUPE TESTS ==========
  describe('dedupe', () => {

    describe('generateDedupeKey', () => {
      it('should produce consistent keys', () => {
        const opp = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Test project',
          client_email: 'test@example.com',
          company_name: 'ACME'
        });
        const key1 = generateDedupeKey(opp);
        const key2 = generateDedupeKey(opp);
        expect(key1).toBe(key2);
      });

      it('should produce same key for same data', () => {
        const data = {
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Test project',
          client_email: 'test@example.com',
          company_name: 'ACME'
        };
        const opp1 = createOpportunity(data);
        const opp2 = createOpportunity(data);
        expect(generateDedupeKey(opp1)).toBe(generateDedupeKey(opp2));
      });

      it('should produce different key for different data', () => {
        const opp1 = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Project A',
          client_email: 'test1@example.com'
        });
        const opp2 = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Project B',
          client_email: 'test2@example.com'
        });
        expect(generateDedupeKey(opp1)).not.toBe(generateDedupeKey(opp2));
      });

      it('should handle empty fields with fallback', () => {
        const opp = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: '',
          client_email: '',
          company_name: '',
          raw_payload: { test: 'data' }
        });
        const key = generateDedupeKey(opp);
        expect(key).toBeDefined();
        expect(key.length).toBeGreaterThan(0);
      });
    });

    describe('computeSimilarity', () => {
      it('should return 1.0 for identical opportunities', () => {
        const opp1 = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Same project',
          client_email: 'test@example.com',
          company_name: 'ACME'
        });
        const opp2 = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Same project',
          client_email: 'test@example.com',
          company_name: 'ACME'
        });
        const similarity = computeSimilarity(opp1, opp2);
        expect(similarity).toBe(1.0);
      });

      it('should return low similarity for completely different opportunities', () => {
        const opp1 = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Project A',
          client_email: 'test1@example.com',
          company_name: 'ACME'
        });
        const opp2 = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Different',
          client_email: 'test2@example.com',
          company_name: 'XYZ Corp'
        });
        const similarity = computeSimilarity(opp1, opp2);
        expect(similarity).toBeLessThan(0.5);
      });

      it('should compute moderate similarity for same email different title', () => {
        const opp1 = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Project A',
          client_email: 'test@example.com'
        });
        const opp2 = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Project B',
          client_email: 'test@example.com'
        });
        const similarity = computeSimilarity(opp1, opp2);
        expect(similarity).toBeGreaterThan(0.5);
      });

      it('should return 1.0 for matching source_record_id', () => {
        const opp1 = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Project A',
          source_record_id: 'rec-123'
        });
        const opp2 = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Project B',
          source_record_id: 'rec-123'
        });
        const similarity = computeSimilarity(opp1, opp2);
        expect(similarity).toBe(1.0);
      });
    });

    describe('dedupeOpportunities', () => {
      it('should handle batch with no duplicates', () => {
        const opps = [
          createOpportunity({
            source_type: SOURCE_TYPES.FORM,
            source_name: 'form',
            title: 'Project A',
            client_email: 'test1@example.com'
          }),
          createOpportunity({
            source_type: SOURCE_TYPES.FORM,
            source_name: 'form',
            title: 'Project B',
            client_email: 'test2@example.com'
          })
        ];
        const result = dedupeOpportunities(opps);
        expect(result.unique).toHaveLength(2);
        expect(result.duplicates).toHaveLength(0);
      });

      it('should detect exact duplicate against existing', () => {
        const existing = [
          createOpportunity({
            source_type: SOURCE_TYPES.FORM,
            source_name: 'form',
            title: 'Project A',
            client_email: 'test@example.com',
            company_name: 'ACME'
          })
        ];
        const newOpp = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Project A',
          client_email: 'test@example.com',
          company_name: 'ACME'
        });
        const result = dedupeOpportunities([newOpp], existing);
        expect(result.unique).toHaveLength(0);
        expect(result.duplicates).toHaveLength(1);
      });

      it('should detect batch internal duplicate', () => {
        const opps = [
          createOpportunity({
            source_type: SOURCE_TYPES.FORM,
            source_name: 'form',
            title: 'Project A',
            client_email: 'test@example.com'
          }),
          createOpportunity({
            source_type: SOURCE_TYPES.FORM,
            source_name: 'form',
            title: 'Project A',
            client_email: 'test@example.com'
          })
        ];
        const result = dedupeOpportunities(opps);
        expect(result.unique).toHaveLength(1);
        expect(result.duplicates).toHaveLength(1);
      });

      it('should detect fuzzy match', () => {
        const existing = [
          createOpportunity({
            source_type: SOURCE_TYPES.FORM,
            source_name: 'form',
            title: 'Blog article about HR',
            client_email: 'test@example.com',
            company_name: 'ACME'
          })
        ];
        const newOpp = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Blog about HR',
          client_email: 'test@example.com',
          company_name: 'ACME'
        });
        const result = dedupeOpportunities([newOpp], existing, { similarityThreshold: 0.7 });
        expect(result.unique).toHaveLength(0);
        expect(result.duplicates).toHaveLength(1);
      });

      it('should not flag below-threshold fuzzy match', () => {
        const existing = [
          createOpportunity({
            source_type: SOURCE_TYPES.FORM,
            source_name: 'form',
            title: 'Project about HR benefits',
            client_email: 'test1@example.com',
            company_name: 'ACME'
          })
        ];
        const newOpp = createOpportunity({
          source_type: SOURCE_TYPES.FORM,
          source_name: 'form',
          title: 'Very different project',
          client_email: 'test2@example.com',
          company_name: 'XYZ'
        });
        const result = dedupeOpportunities([newOpp], existing, { similarityThreshold: 0.8 });
        expect(result.unique).toHaveLength(1);
        expect(result.duplicates).toHaveLength(0);
      });

      it('should provide correct stats', () => {
        const opps = [
          createOpportunity({
            source_type: SOURCE_TYPES.FORM,
            source_name: 'form',
            title: 'Project A',
            client_email: 'test1@example.com'
          }),
          createOpportunity({
            source_type: SOURCE_TYPES.FORM,
            source_name: 'form',
            title: 'Project B',
            client_email: 'test2@example.com'
          }),
          createOpportunity({
            source_type: SOURCE_TYPES.FORM,
            source_name: 'form',
            title: 'Project A',
            client_email: 'test1@example.com'
          })
        ];
        const result = dedupeOpportunities(opps);
        expect(result.stats.total).toBe(3);
        expect(result.stats.unique).toBe(2);
        expect(result.stats.duplicates).toBe(1);
      });

      it('should handle empty inputs', () => {
        const result = dedupeOpportunities([]);
        expect(result.unique).toEqual([]);
        expect(result.duplicates).toEqual([]);
        expect(result.stats.total).toBe(0);
      });
    });
  });

});
