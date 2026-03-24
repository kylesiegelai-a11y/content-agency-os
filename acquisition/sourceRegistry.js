/**
 * Source Registry
 * Manages acquisition source lifecycle, enablement, and production safety.
 */

const logger = require('../utils/logger');

const MOCK_MODE = process.env.MOCK_MODE === 'true' || process.env.MOCK_MODE === '1';
const STRICT_PRODUCTION = process.env.ACQUISITION_STRICT_PRODUCTION !== 'false'; // default true

class SourceRegistry {
  constructor(options = {}) {
    this._sources = new Map();
    this._mockMode = options.mockMode !== undefined ? options.mockMode : MOCK_MODE;
    this._strictProduction = options.strictProduction !== undefined ? options.strictProduction : STRICT_PRODUCTION;
  }

  /**
   * Register an acquisition source
   * @param {AcquisitionSource} source
   * @param {Object} options - { mockOnly: false }
   */
  register(source, options = {}) {
    const entry = {
      source,
      mockOnly: options.mockOnly === true,
      registeredAt: new Date().toISOString()
    };

    // Production safety: refuse to register mock-only sources in production strict mode
    if (entry.mockOnly && !this._mockMode && this._strictProduction) {
      logger.warn(`[SourceRegistry] Refusing to register mock-only source "${source.name}" in production mode`);
      return { registered: false, reason: 'mock_only_in_production' };
    }

    this._sources.set(source.name, entry);
    logger.info(`[SourceRegistry] Registered source: ${source.name} (type=${source.sourceType}, enabled=${source.enabled}, mockOnly=${entry.mockOnly})`);
    return { registered: true };
  }

  /**
   * Get a source by name. Returns null if not found or disabled.
   */
  getSource(name) {
    const entry = this._sources.get(name);
    if (!entry) return null;
    return entry.source;
  }

  /**
   * Get all active (enabled, non-mock-in-production) sources
   */
  getActiveSources() {
    const active = [];
    for (const [name, entry] of this._sources) {
      if (!entry.source.enabled) continue;
      if (entry.mockOnly && !this._mockMode) continue;
      active.push(entry.source);
    }
    return active;
  }

  /**
   * Get full status of all registered sources.
   * Each status includes:
   *   effectiveStatus: 'healthy' | 'unavailable' | 'disabled' | 'mock_only'
   *   activeInCurrentMode: whether this source will participate in acquisition cycles
   */
  getSourceStatuses() {
    const statuses = [];
    for (const [name, entry] of this._sources) {
      const status = entry.source.getStatus();
      status.mockOnly = entry.mockOnly;
      status.activeInCurrentMode = entry.source.enabled && (!entry.mockOnly || this._mockMode);

      // Override effectiveStatus for mock-only sources when not in mock mode
      if (entry.mockOnly && !this._mockMode) {
        status.effectiveStatus = 'mock_only';
      }

      statuses.push(status);
    }
    return statuses;
  }

  /**
   * Fetch opportunities from all active sources
   * Returns { opportunities: [], errors: [], sourceResults: [] }
   */
  async fetchAllOpportunities(params = {}) {
    const activeSources = this.getActiveSources();
    const results = {
      opportunities: [],
      errors: [],
      sourceResults: []
    };

    if (activeSources.length === 0) {
      logger.info('[SourceRegistry] No active acquisition sources configured');
      return results;
    }

    for (const source of activeSources) {
      try {
        const raw = await source.fetchOpportunities(params);
        const normalized = [];

        for (const payload of raw) {
          const validation = source.validatePayload(payload);
          if (!validation.valid) {
            results.errors.push({
              source: source.name,
              type: 'validation_error',
              errors: validation.errors,
              payload: payload
            });
            continue;
          }

          try {
            const opp = source.normalizeOpportunity(payload);
            normalized.push(opp);
          } catch (normErr) {
            results.errors.push({
              source: source.name,
              type: 'normalization_error',
              message: normErr.message
            });
          }
        }

        source._recordSuccess(normalized.length);
        results.opportunities.push(...normalized);
        results.sourceResults.push({
          source: source.name,
          fetched: raw.length,
          normalized: normalized.length,
          errors: raw.length - normalized.length
        });

      } catch (fetchErr) {
        source._recordError(fetchErr);
        results.errors.push({
          source: source.name,
          type: 'fetch_error',
          message: fetchErr.message
        });
        results.sourceResults.push({
          source: source.name,
          fetched: 0,
          normalized: 0,
          errors: 1,
          errorMessage: fetchErr.message
        });
        logger.error(`[SourceRegistry] Source "${source.name}" fetch failed: ${fetchErr.message}`);
      }
    }

    return results;
  }

  /**
   * Check if the system is in mock mode
   */
  isMockMode() {
    return this._mockMode;
  }

  /**
   * Get count of active sources
   */
  getActiveSourceCount() {
    return this.getActiveSources().length;
  }
}

module.exports = SourceRegistry;
