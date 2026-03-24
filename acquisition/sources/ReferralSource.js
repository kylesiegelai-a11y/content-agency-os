/**
 * ReferralSource - Referral/partner ingestion
 */

const AcquisitionSource = require('../AcquisitionSource');
const { SOURCE_TYPES, createOpportunity } = require('../opportunitySchema');

class ReferralSource extends AcquisitionSource {
  constructor(options = {}) {
    super('referral', SOURCE_TYPES.REFERRAL, options);
    this._queue = [];
  }

  /**
   * Submit a referral - validates and queues it
   * @param {Object} payload - Referral payload
   * @returns {Object} { valid: boolean, errors: string[], id?: string }
   */
  submitReferral(payload) {
    const validation = this.validatePayload(payload);
    if (!validation.valid) {
      return { valid: false, errors: validation.errors };
    }

    const id = payload.id || `referral-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const referral = {
      ...payload,
      id,
      submitted_at: new Date().toISOString()
    };

    this._queue.push(referral);
    return { valid: true, errors: [], id };
  }

  /**
   * Fetch opportunities from queued referrals
   * @returns {Promise<Array<Object>>}
   */
  async fetchOpportunities(params = {}) {
    try {
      const opportunities = this._queue.map(raw => this.normalizeOpportunity(raw));
      this._recordSuccess(opportunities.length);
      return opportunities;
    } catch (error) {
      this._recordError(error);
      throw error;
    }
  }

  /**
   * Validate referral payload
   * @param {Object} raw - Raw payload
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  validatePayload(raw) {
    const errors = [];

    if (!raw || typeof raw !== 'object') {
      errors.push('Payload must be a non-null object');
      return { valid: false, errors };
    }

    if (!raw.referrer_name || typeof raw.referrer_name !== 'string' || raw.referrer_name.trim().length === 0) {
      errors.push('referrer_name is required and must be a non-empty string');
    }

    const hasClientInfo = !!(raw.client_name || raw.client_email);
    if (!hasClientInfo) {
      errors.push('At least one of client_name or client_email is required');
    }

    if (!raw.title || typeof raw.title !== 'string' || raw.title.trim().length === 0) {
      errors.push('title is required and must be a non-empty string');
    }

    if (raw.client_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.client_email)) {
      errors.push('client_email must be a valid email format');
    }

    if (raw.referrer_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.referrer_email)) {
      errors.push('referrer_email must be a valid email format');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Normalize referral to opportunity schema
   * @param {Object} raw - Raw referral
   * @returns {Object} Normalized opportunity
   */
  normalizeOpportunity(raw) {
    return createOpportunity({
      id: raw.id,
      source_type: SOURCE_TYPES.REFERRAL,
      source_name: this.name,
      source_record_id: raw.id,
      received_at: raw.submitted_at || new Date().toISOString(),
      title: raw.title || '',
      description: raw.description || raw.notes || '',
      client_name: raw.client_name || '',
      client_email: raw.client_email || '',
      company_name: raw.company_name || '',
      budget_min: typeof raw.budget === 'number' ? raw.budget : null,
      budget_max: null,
      tags: [],
      raw_payload: raw,
      confidence_score: 0.9,
      status: 'normalized',
      metadata: {
        referrer_name: raw.referrer_name,
        referrer_email: raw.referrer_email || '',
        referrer_company: raw.referrer_company || '',
        referral_date: raw.submitted_at || new Date().toISOString()
      }
    });
  }
}

module.exports = ReferralSource;
