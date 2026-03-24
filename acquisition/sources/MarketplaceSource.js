/**
 * MarketplaceSource - Marketplace abstraction (Upwork as optional connector)
 */

const AcquisitionSource = require('../AcquisitionSource');
const { SOURCE_TYPES, createOpportunity } = require('../opportunitySchema');

class MarketplaceSource extends AcquisitionSource {
  constructor(marketplaceService, options = {}) {
    const name = options.name || 'upwork';
    super(name, SOURCE_TYPES.MARKETPLACE, options);
    this.marketplaceService = marketplaceService;
    this.mockMode = options.mockMode !== false; // default true for safety
  }

  /**
   * Fetch opportunities from marketplace
   * @param {Object} params - Marketplace-specific search params
   * @returns {Promise<Array<Object>>}
   */
  async fetchOpportunities(params = {}) {
    try {
      // CRITICAL: In production mode, if service is mock, throw error
      if (!this.mockMode && this._isMockService()) {
        throw new Error('Marketplace source unavailable in production: no real provider configured');
      }

      if (!this.marketplaceService || typeof this.marketplaceService.searchJobs !== 'function') {
        throw new Error('marketplaceService must have searchJobs method');
      }

      const jobs = await this.marketplaceService.searchJobs(params);
      const opportunities = jobs
        .map(job => this.normalizeOpportunity(job))
        .filter(opp => opp !== null);

      this._recordSuccess(opportunities.length);
      return opportunities;
    } catch (error) {
      this._recordError(error);
      throw error;
    }
  }

  /**
   * Check if marketplace service is a mock
   * @returns {boolean}
   */
  _isMockService() {
    if (!this.marketplaceService) return true;
    const className = this.marketplaceService.constructor.name || '';
    return className.toLowerCase().includes('mock') ||
           this.marketplaceService._isMock === true ||
           typeof this.marketplaceService.searchJobs !== 'function';
  }

  /**
   * Validate marketplace job payload
   * @param {Object} job - Job object
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  validatePayload(job) {
    const errors = [];

    if (!job || typeof job !== 'object') {
      errors.push('Job must be a non-null object');
      return { valid: false, errors };
    }

    if (!job.title || typeof job.title !== 'string' || job.title.trim().length === 0) {
      errors.push('title is required and must be a non-empty string');
    }

    if (!job.id || (typeof job.id !== 'string' && typeof job.id !== 'number')) {
      errors.push('id is required and must be a string or number');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Normalize marketplace job to opportunity schema
   * Maps Upwork-specific fields to standard schema
   * @param {Object} job - Raw marketplace job
   * @returns {Object} Normalized opportunity
   */
  normalizeOpportunity(job) {
    if (!job) return null;

    const tags = [];
    if (job.skills) {
      if (Array.isArray(job.skills)) {
        tags.push(...job.skills);
      } else if (typeof job.skills === 'string') {
        tags.push(job.skills);
      }
    }

    // Extract budget from job
    let budgetMin = null;
    let budgetMax = null;
    if (job.budget) {
      if (typeof job.budget === 'number') {
        budgetMin = job.budget;
      } else if (typeof job.budget === 'object') {
        if (typeof job.budget.min === 'number') budgetMin = job.budget.min;
        if (typeof job.budget.max === 'number') budgetMax = job.budget.max;
      }
    }

    return createOpportunity({
      id: `${this.name}-${job.id}`,
      source_type: SOURCE_TYPES.MARKETPLACE,
      source_name: this.name,
      source_record_id: job.id,
      received_at: job.postedDate || new Date().toISOString(),
      title: job.title || '',
      description: job.description || '',
      client_name: job.clientName || '',
      client_email: '',
      company_name: job.company || '',
      budget_min: budgetMin,
      budget_max: budgetMax,
      currency: job.currency || 'USD',
      tags,
      raw_payload: job,
      confidence_score: 0.8,
      status: 'normalized',
      metadata: {
        marketplace_id: job.id,
        experience_level: job.experienceLevel || '',
        duration: job.duration || '',
        client_rating: job.clientRating || null,
        client_review_count: job.clientReviewCount || null,
        job_url: job.url || ''
      }
    });
  }
}

module.exports = MarketplaceSource;
