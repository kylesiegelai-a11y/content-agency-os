/**
 * Shared Opportunity Schema
 * All acquisition sources normalize into this model
 */

const { v4: uuidv4 } = require('uuid');

const OPPORTUNITY_STATUSES = {
  NEW: 'new',
  NORMALIZED: 'normalized',
  SCORED: 'scored',
  NEEDS_REVIEW: 'needs_review',
  QUALIFIED: 'qualified',
  REJECTED: 'rejected',
  IMPORTED: 'imported',
  SOURCE_ERROR: 'source_error',
  DUPLICATE: 'duplicate'
};

const SOURCE_TYPES = {
  FORM: 'form',
  GMAIL: 'gmail',
  CSV_IMPORT: 'csv_import',
  REFERRAL: 'referral',
  MARKETPLACE: 'marketplace',
  MANUAL: 'manual'
};

/**
 * Create a new normalized opportunity from raw source data
 */
function createOpportunity(fields = {}) {
  return {
    id: fields.id || uuidv4(),
    source_type: fields.source_type || null,
    source_name: fields.source_name || null,
    source_record_id: fields.source_record_id || null,
    received_at: fields.received_at || new Date().toISOString(),
    title: fields.title || '',
    description: fields.description || '',
    client_name: fields.client_name || '',
    client_email: fields.client_email || '',
    company_name: fields.company_name || '',
    budget_min: typeof fields.budget_min === 'number' ? fields.budget_min : null,
    budget_max: typeof fields.budget_max === 'number' ? fields.budget_max : null,
    currency: fields.currency || 'USD',
    timeline: fields.timeline || null,
    location: fields.location || null,
    tags: Array.isArray(fields.tags) ? fields.tags : [],
    raw_payload: fields.raw_payload || null,
    normalized_payload: fields.normalized_payload || null,
    confidence_score: typeof fields.confidence_score === 'number' ? fields.confidence_score : null,
    qualification_score: typeof fields.qualification_score === 'number' ? fields.qualification_score : null,
    status: fields.status || OPPORTUNITY_STATUSES.NEW,
    review_reason: fields.review_reason || null,
    dedupe_key: fields.dedupe_key || null,
    metadata: fields.metadata || {},
    scoring_reasons: fields.scoring_reasons || null,
    created_at: fields.created_at || new Date().toISOString(),
    updated_at: fields.updated_at || new Date().toISOString()
  };
}

/**
 * Validate required fields on an opportunity
 * Returns { valid: boolean, errors: string[] }
 */
function validateOpportunity(opp) {
  const errors = [];
  if (!opp.source_type || !Object.values(SOURCE_TYPES).includes(opp.source_type)) {
    errors.push(`Invalid or missing source_type: ${opp.source_type}`);
  }
  if (!opp.source_name) {
    errors.push('source_name is required');
  }
  if (!opp.title || typeof opp.title !== 'string' || opp.title.trim().length === 0) {
    errors.push('title is required and must be a non-empty string');
  }
  if (opp.budget_min !== null && (typeof opp.budget_min !== 'number' || opp.budget_min < 0)) {
    errors.push('budget_min must be a non-negative number or null');
  }
  if (opp.budget_max !== null && (typeof opp.budget_max !== 'number' || opp.budget_max < 0)) {
    errors.push('budget_max must be a non-negative number or null');
  }
  if (opp.budget_min !== null && opp.budget_max !== null && opp.budget_min > opp.budget_max) {
    errors.push('budget_min cannot exceed budget_max');
  }
  if (opp.client_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(opp.client_email)) {
    errors.push('client_email must be a valid email format');
  }
  return { valid: errors.length === 0, errors };
}

module.exports = {
  OPPORTUNITY_STATUSES,
  SOURCE_TYPES,
  createOpportunity,
  validateOpportunity
};
