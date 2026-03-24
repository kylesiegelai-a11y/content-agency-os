/**
 * FormSource - Inbound form/webhook source for structured lead submissions
 */

const AcquisitionSource = require('../AcquisitionSource');
const { SOURCE_TYPES, createOpportunity } = require('../opportunitySchema');

class FormSource extends AcquisitionSource {
  constructor(options = {}) {
    super('form', SOURCE_TYPES.FORM, options);
    this._queue = [];
  }

  /**
   * Return the internal queue of form submissions
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
   * Submit a form - validates and queues the submission
   * @param {Object} payload - Form submission payload
   * @returns {Object} { valid: boolean, errors: string[], id?: string }
   */
  submitForm(payload) {
    const validation = this.validatePayload(payload);
    if (!validation.valid) {
      return { valid: false, errors: validation.errors };
    }

    const id = payload.id || `form-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const submission = {
      ...payload,
      id,
      submitted_at: new Date().toISOString()
    };

    this._queue.push(submission);
    return { valid: true, errors: [], id };
  }

  /**
   * Validate form submission payload
   * @param {Object} raw - Raw payload
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  validatePayload(raw) {
    const errors = [];

    if (!raw || typeof raw !== 'object') {
      errors.push('Payload must be a non-null object');
      return { valid: false, errors };
    }

    if (!raw.title || typeof raw.title !== 'string' || raw.title.trim().length === 0) {
      errors.push('title is required and must be a non-empty string');
    }

    // Accept both form-friendly (name, email, company) and schema-friendly (client_name, etc.) field names
    const hasClientInfo = !!(
      raw.client_name || raw.name ||
      raw.client_email || raw.email ||
      raw.company_name || raw.company
    );
    if (!hasClientInfo) {
      errors.push('At least one of client_name, client_email, or company_name is required');
    }

    const email = raw.client_email || raw.email;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push('client_email must be a valid email format');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Normalize form submission to opportunity schema
   * @param {Object} raw - Raw form submission
   * @returns {Object} Normalized opportunity
   */
  normalizeOpportunity(raw) {
    const tags = [];
    if (raw.services) {
      if (Array.isArray(raw.services)) {
        tags.push(...raw.services);
      } else if (typeof raw.services === 'string') {
        tags.push(raw.services);
      }
    }

    return createOpportunity({
      id: raw.id,
      source_type: SOURCE_TYPES.FORM,
      source_name: this.name,
      source_record_id: raw.id,
      received_at: raw.submitted_at || new Date().toISOString(),
      title: raw.title || '',
      description: raw.description || raw.message || '',
      client_name: raw.name || raw.client_name || '',
      client_email: raw.email || raw.client_email || '',
      company_name: raw.company || raw.company_name || '',
      budget_min: typeof raw.budget === 'number' ? raw.budget : null,
      budget_max: null,
      timeline: raw.timeline || null,
      tags,
      raw_payload: raw,
      confidence_score: 0.95,
      status: 'normalized',
      metadata: {
        form_source: 'direct_submission'
      }
    });
  }
}

module.exports = FormSource;
