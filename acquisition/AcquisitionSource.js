/**
 * AcquisitionSource - Base class for all acquisition source plugins
 * Each source must extend this and implement the required methods.
 */

class AcquisitionSource {
  constructor(name, sourceType, options = {}) {
    if (new.target === AcquisitionSource) {
      throw new Error('AcquisitionSource is abstract and cannot be instantiated directly');
    }
    this.name = name;
    this.sourceType = sourceType;
    this.enabled = options.enabled !== false; // default true
    this._healthy = true;
    this._lastError = null;
    this._lastFetchAt = null;
    this._stats = {
      ingested: 0,
      normalized: 0,
      errors: 0,
      lastRunAt: null
    };
  }

  /**
   * Fetch or receive opportunities from this source.
   * Must return an array of raw payloads.
   * @param {Object} params - source-specific parameters
   * @returns {Promise<Array<Object>>} Raw payloads
   */
  async fetchOpportunities(params = {}) {
    throw new Error('fetchOpportunities() must be implemented by subclass');
  }

  /**
   * Normalize a single raw payload into a standard opportunity.
   * @param {Object} rawPayload
   * @returns {Object} Normalized opportunity (opportunitySchema format)
   */
  normalizeOpportunity(rawPayload) {
    throw new Error('normalizeOpportunity() must be implemented by subclass');
  }

  /**
   * Validate a raw payload before normalization.
   * Return { valid: boolean, errors: string[] }
   */
  validatePayload(rawPayload) {
    if (!rawPayload || typeof rawPayload !== 'object') {
      return { valid: false, errors: ['Payload must be a non-null object'] };
    }
    return { valid: true, errors: [] };
  }

  /**
   * Get health status of this source.
   * Status categories:
   *   - enabled + healthy:      fully operational
   *   - enabled + !healthy:     enabled but unavailable (last fetch errored)
   *   - !enabled:               disabled by configuration
   *   - mockOnly (set by registry): only active in mock mode
   */
  getStatus() {
    let effectiveStatus = 'disabled';
    if (this.enabled && this._healthy) effectiveStatus = 'healthy';
    else if (this.enabled && !this._healthy) effectiveStatus = 'unavailable';

    return {
      name: this.name,
      sourceType: this.sourceType,
      enabled: this.enabled,
      healthy: this._healthy,
      effectiveStatus,
      lastError: this._lastError,
      lastFetchAt: this._lastFetchAt,
      stats: { ...this._stats }
    };
  }

  /**
   * Record an error for observability
   */
  _recordError(error) {
    this._healthy = false;
    this._lastError = {
      message: error.message,
      timestamp: new Date().toISOString()
    };
    this._stats.errors++;
  }

  /**
   * Record successful fetch
   */
  _recordSuccess(count) {
    this._healthy = true;
    this._lastError = null;
    this._lastFetchAt = new Date().toISOString();
    this._stats.ingested += count;
    this._stats.lastRunAt = this._lastFetchAt;
  }
}

module.exports = AcquisitionSource;
