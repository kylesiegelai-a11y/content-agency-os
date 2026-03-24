/**
 * Acquisition Engine
 * Main orchestrator for source-agnostic opportunity acquisition.
 * Coordinates: fetch → normalize → score → dedupe → persist → observe
 */

const logger = require('../utils/logger');
const { OPPORTUNITY_STATUSES } = require('./opportunitySchema');
const { qualifyOpportunities } = require('./scoring');
const { dedupeOpportunities, generateDedupeKey } = require('./dedupe');

const MOCK_MODE = process.env.MOCK_MODE === 'true' || process.env.MOCK_MODE === '1';

class AcquisitionEngine {
  constructor(options = {}) {
    this.registry = options.registry; // SourceRegistry instance
    this.storage = options.storage;   // Storage instance
    this.scoringConfig = options.scoringConfig || {};
    this.dedupeOptions = options.dedupeOptions || {};
    this._metrics = {
      opportunities_ingested_total: 0,
      opportunities_qualified_total: 0,
      opportunities_needs_review_total: 0,
      opportunities_rejected_total: 0,
      acquisition_source_errors_total: 0,
      opportunities_deduped_total: 0,
      last_run_at: null,
      runs_total: 0
    };
  }

  /**
   * Run a full acquisition cycle: fetch → normalize → score → dedupe → persist
   * @param {Object} params - Optional source-specific params
   * @returns {Object} Acquisition run report
   */
  async runAcquisitionCycle(params = {}) {
    const startTime = Date.now();
    logger.info('[AcquisitionEngine] Starting acquisition cycle');

    // 1. Fetch from all active sources
    const fetchResult = await this.registry.fetchAllOpportunities(params);

    this._metrics.acquisition_source_errors_total += fetchResult.errors.length;

    if (fetchResult.opportunities.length === 0 && fetchResult.errors.length === 0) {
      logger.info('[AcquisitionEngine] No opportunities found from any source');
      this._metrics.last_run_at = new Date().toISOString();
      this._metrics.runs_total++;
      return this._buildReport(startTime, fetchResult, { qualified: [], needsReview: [], rejected: [] }, { unique: [], duplicates: [], stats: { total: 0, unique: 0, duplicates: 0 } });
    }

    // 2. Score and qualify
    const qualResult = qualifyOpportunities(fetchResult.opportunities, this.scoringConfig);

    // 3. Dedupe against existing
    const existing = await this._loadExistingOpportunities();
    const allScored = [...qualResult.qualified, ...qualResult.needsReview, ...qualResult.rejected];
    const dedupeResult = dedupeOpportunities(allScored, existing, this.dedupeOptions);

    // 4. Persist unique opportunities
    const toPersist = dedupeResult.unique;
    if (toPersist.length > 0 && this.storage) {
      await this._persistOpportunities(toPersist);
    }

    // 5. Persist duplicates with duplicate status
    if (dedupeResult.duplicates.length > 0 && this.storage) {
      // Don't persist duplicates, just log them
      logger.info(`[AcquisitionEngine] Skipped ${dedupeResult.duplicates.length} duplicate opportunities`);
    }

    // 6. Update metrics
    const uniqueQualified = toPersist.filter(o => o.status === OPPORTUNITY_STATUSES.QUALIFIED).length;
    const uniqueNeedsReview = toPersist.filter(o => o.status === OPPORTUNITY_STATUSES.NEEDS_REVIEW).length;
    const uniqueRejected = toPersist.filter(o => o.status === OPPORTUNITY_STATUSES.REJECTED).length;

    this._metrics.opportunities_ingested_total += fetchResult.opportunities.length;
    this._metrics.opportunities_qualified_total += uniqueQualified;
    this._metrics.opportunities_needs_review_total += uniqueNeedsReview;
    this._metrics.opportunities_rejected_total += uniqueRejected;
    this._metrics.opportunities_deduped_total += dedupeResult.duplicates.length;
    this._metrics.last_run_at = new Date().toISOString();
    this._metrics.runs_total++;

    // 7. Log ingestion event
    if (this.storage) {
      await this._logIngestionEvent(fetchResult, qualResult, dedupeResult, startTime);
    }

    const report = this._buildReport(startTime, fetchResult, qualResult, dedupeResult);
    logger.info(`[AcquisitionEngine] Cycle complete: ${toPersist.length} persisted, ${dedupeResult.duplicates.length} duped, ${fetchResult.errors.length} errors`);
    return report;
  }

  /**
   * Ingest a single opportunity from an external source (e.g., form, webhook)
   * Bypasses fetchOpportunities — used for push-based sources.
   */
  async ingestSingleOpportunity(opportunity) {
    // Score
    const { scoreOpportunity } = require('./scoring');
    const scoreResult = scoreOpportunity(opportunity, this.scoringConfig);
    opportunity.qualification_score = scoreResult.score;
    opportunity.scoring_reasons = scoreResult.reasons;
    opportunity.status = scoreResult.status;
    opportunity.updated_at = new Date().toISOString();

    // Dedupe
    const existing = await this._loadExistingOpportunities();
    const dedupeResult = dedupeOpportunities([opportunity], existing, this.dedupeOptions);

    if (dedupeResult.unique.length === 0) {
      return { persisted: false, reason: 'duplicate', opportunity: dedupeResult.duplicates[0] };
    }

    // Persist
    const opp = dedupeResult.unique[0];
    if (this.storage) {
      await this._persistOpportunities([opp]);
    }

    this._metrics.opportunities_ingested_total++;
    if (opp.status === OPPORTUNITY_STATUSES.QUALIFIED) this._metrics.opportunities_qualified_total++;
    else if (opp.status === OPPORTUNITY_STATUSES.NEEDS_REVIEW) this._metrics.opportunities_needs_review_total++;
    else if (opp.status === OPPORTUNITY_STATUSES.REJECTED) this._metrics.opportunities_rejected_total++;

    return { persisted: true, opportunity: opp };
  }

  /**
   * Review an opportunity (approve or reject from needs_review)
   */
  async reviewOpportunity(opportunityId, action, reviewNotes = '') {
    if (!this.storage) return { error: 'Storage not configured' };

    const opps = await this._loadExistingOpportunities();
    const opp = opps.find(o => o.id === opportunityId);
    if (!opp) return { error: 'Opportunity not found' };
    if (opp.status !== OPPORTUNITY_STATUSES.NEEDS_REVIEW) {
      return { error: `Cannot review opportunity with status "${opp.status}"` };
    }

    if (action === 'approve') {
      opp.status = OPPORTUNITY_STATUSES.QUALIFIED;
    } else if (action === 'reject') {
      opp.status = OPPORTUNITY_STATUSES.REJECTED;
    } else {
      return { error: `Invalid action: ${action}. Must be "approve" or "reject"` };
    }

    opp.review_reason = reviewNotes || `Manually ${action}d`;
    opp.updated_at = new Date().toISOString();
    opp.metadata = opp.metadata || {};
    opp.metadata.reviewed_at = new Date().toISOString();

    await this.storage.updateById('opportunities.json', opportunityId, opp);
    return { success: true, opportunity: opp };
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    return { ...this._metrics };
  }

  /**
   * Get source health/status
   */
  getSourceStatuses() {
    return this.registry ? this.registry.getSourceStatuses() : [];
  }

  // --- Private methods ---

  async _loadExistingOpportunities() {
    if (!this.storage) return [];
    try {
      const data = await this.storage.read('opportunities.json');
      if (data && data.items) return data.items;
      if (Array.isArray(data)) return data;
      return [];
    } catch {
      return [];
    }
  }

  async _persistOpportunities(opportunities) {
    for (const opp of opportunities) {
      await this.storage.append('opportunities.json', opp);
    }
  }

  async _logIngestionEvent(fetchResult, qualResult, dedupeResult, startTime) {
    try {
      await this.storage.append('acquisition_events.json', {
        type: 'ACQUISITION_CYCLE',
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        sourceResults: fetchResult.sourceResults,
        totals: {
          fetched: fetchResult.opportunities.length,
          qualified: qualResult.qualified.length,
          needsReview: qualResult.needsReview.length,
          rejected: qualResult.rejected.length,
          deduplicated: dedupeResult.duplicates.length,
          errors: fetchResult.errors.length
        }
      });
    } catch (err) {
      logger.error('[AcquisitionEngine] Failed to log ingestion event:', err.message);
    }
  }

  _buildReport(startTime, fetchResult, qualResult, dedupeResult) {
    return {
      durationMs: Date.now() - startTime,
      sources: fetchResult.sourceResults || [],
      totals: {
        fetched: fetchResult.opportunities ? fetchResult.opportunities.length : 0,
        qualified: qualResult.qualified ? qualResult.qualified.length : 0,
        needsReview: qualResult.needsReview ? qualResult.needsReview.length : 0,
        rejected: qualResult.rejected ? qualResult.rejected.length : 0,
        deduplicated: dedupeResult.duplicates ? dedupeResult.duplicates.length : 0,
        persisted: dedupeResult.unique ? dedupeResult.unique.length : 0,
        errors: fetchResult.errors ? fetchResult.errors.length : 0
      },
      errors: fetchResult.errors || [],
      dedupeStats: dedupeResult.stats || null
    };
  }
}

module.exports = AcquisitionEngine;
