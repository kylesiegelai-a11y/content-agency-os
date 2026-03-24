/**
 * Opportunity Scoring & Qualification Pipeline
 * Deterministic, tested, explainable scoring across all sources.
 */

const { OPPORTUNITY_STATUSES } = require('./opportunitySchema');

// Default scoring weights (0-1, must sum to 1.0)
const DEFAULT_WEIGHTS = {
  contentFit: 0.20,
  budgetFit: 0.25,
  serviceFit: 0.15,
  urgency: 0.10,
  completeness: 0.15,
  confidence: 0.15
};

// Default configuration
const DEFAULT_CONFIG = {
  qualificationThreshold: 65,   // score >= 65 → qualified
  reviewThreshold: 40,          // 40 <= score < 65 → needs_review
  targetNiches: ['HR', 'PEO', 'benefits', 'compliance', 'SaaS', 'content writing'],
  targetServices: ['blog posts', 'articles', 'white papers', 'case studies', 'email campaigns', 'web copy', 'technical writing'],
  minBudget: 500,
  idealBudget: 2000,
  maxBudget: 50000,
  weights: DEFAULT_WEIGHTS
};

/**
 * Score a normalized opportunity
 * @param {Object} opportunity - Normalized opportunity object
 * @param {Object} config - Scoring configuration
 * @returns {Object} { score, breakdown, reasons, status }
 */
function scoreOpportunity(opportunity, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config, weights: { ...DEFAULT_WEIGHTS, ...(config.weights || {}) } };
  const breakdown = {};
  const reasons = [];

  // 1. Content Fit (does this match our niches/expertise?)
  breakdown.contentFit = _scoreContentFit(opportunity, cfg);
  if (breakdown.contentFit.score >= 70) reasons.push(`Strong niche fit: ${breakdown.contentFit.matchedNiches.join(', ')}`);
  else if (breakdown.contentFit.score < 30) reasons.push('Low niche relevance');

  // 2. Budget Fit
  breakdown.budgetFit = _scoreBudgetFit(opportunity, cfg);
  if (breakdown.budgetFit.score >= 70) reasons.push(`Budget in range: $${opportunity.budget_min || 0}-$${opportunity.budget_max || '?'}`);
  else if (breakdown.budgetFit.score < 30) reasons.push('Budget below minimum threshold');

  // 3. Service Fit
  breakdown.serviceFit = _scoreServiceFit(opportunity, cfg);
  if (breakdown.serviceFit.score >= 70) reasons.push(`Service match: ${breakdown.serviceFit.matchedServices.join(', ')}`);

  // 4. Urgency
  breakdown.urgency = _scoreUrgency(opportunity);
  if (breakdown.urgency.score >= 70) reasons.push('High urgency signals detected');

  // 5. Completeness (how much info do we have?)
  breakdown.completeness = _scoreCompleteness(opportunity);
  if (breakdown.completeness.score < 40) reasons.push('Incomplete opportunity data; may need review');

  // 6. Confidence (source confidence)
  breakdown.confidence = _scoreConfidence(opportunity);
  if (breakdown.confidence.score < 40) reasons.push('Low source confidence; flagged for review');

  // Calculate weighted total
  const w = cfg.weights;
  const totalScore = Math.round(
    breakdown.contentFit.score * w.contentFit +
    breakdown.budgetFit.score * w.budgetFit +
    breakdown.serviceFit.score * w.serviceFit +
    breakdown.urgency.score * w.urgency +
    breakdown.completeness.score * w.completeness +
    breakdown.confidence.score * w.confidence
  );

  // Determine status
  let status;
  if (totalScore >= cfg.qualificationThreshold) {
    status = OPPORTUNITY_STATUSES.QUALIFIED;
    reasons.push(`Score ${totalScore} meets qualification threshold (${cfg.qualificationThreshold})`);
  } else if (totalScore >= cfg.reviewThreshold) {
    status = OPPORTUNITY_STATUSES.NEEDS_REVIEW;
    reasons.push(`Score ${totalScore} is below qualification (${cfg.qualificationThreshold}) but above review threshold (${cfg.reviewThreshold})`);
  } else {
    status = OPPORTUNITY_STATUSES.REJECTED;
    reasons.push(`Score ${totalScore} is below review threshold (${cfg.reviewThreshold})`);
  }

  return { score: totalScore, breakdown, reasons, status };
}

function _scoreContentFit(opp, cfg) {
  const text = `${opp.title} ${opp.description} ${(opp.tags || []).join(' ')}`.toLowerCase();
  const matchedNiches = cfg.targetNiches.filter(n => text.includes(n.toLowerCase()));
  const score = matchedNiches.length > 0 ? Math.min(100, 50 + matchedNiches.length * 25) : 20;
  return { score, matchedNiches };
}

function _scoreBudgetFit(opp, cfg) {
  const budget = opp.budget_max || opp.budget_min || 0;
  if (budget <= 0) return { score: 30, reason: 'No budget specified' };
  if (budget < cfg.minBudget) return { score: Math.round((budget / cfg.minBudget) * 30), reason: 'Below minimum' };
  if (budget >= cfg.idealBudget) return { score: Math.min(100, 70 + Math.round((budget / cfg.maxBudget) * 30)), reason: 'At or above ideal' };
  // Between min and ideal
  const ratio = (budget - cfg.minBudget) / (cfg.idealBudget - cfg.minBudget);
  return { score: Math.round(30 + ratio * 40), reason: 'Between min and ideal' };
}

function _scoreServiceFit(opp, cfg) {
  const text = `${opp.title} ${opp.description} ${(opp.tags || []).join(' ')}`.toLowerCase();
  const matchedServices = cfg.targetServices.filter(s => text.includes(s.toLowerCase()));
  const score = matchedServices.length > 0 ? Math.min(100, 40 + matchedServices.length * 30) : 20;
  return { score, matchedServices };
}

function _scoreUrgency(opp) {
  const text = `${opp.title} ${opp.description} ${opp.timeline || ''}`.toLowerCase();
  const urgentKeywords = ['asap', 'urgent', 'immediately', 'rush', 'deadline', 'this week', 'today'];
  const matches = urgentKeywords.filter(k => text.includes(k));
  if (matches.length > 0) return { score: Math.min(100, 60 + matches.length * 20), signals: matches };

  // Timeline-based urgency
  if (opp.timeline) {
    const tl = opp.timeline.toLowerCase();
    if (tl.includes('1 week') || tl.includes('few days')) return { score: 80, signals: ['short timeline'] };
    if (tl.includes('2 week') || tl.includes('1 month')) return { score: 60, signals: ['moderate timeline'] };
  }
  return { score: 40, signals: [] };
}

function _scoreCompleteness(opp) {
  let filled = 0;
  const fields = ['title', 'description', 'client_name', 'client_email', 'company_name', 'budget_min', 'budget_max', 'timeline', 'tags'];
  for (const f of fields) {
    const val = opp[f];
    if (val !== null && val !== undefined && val !== '' && !(Array.isArray(val) && val.length === 0)) filled++;
  }
  return { score: Math.round((filled / fields.length) * 100), filledFields: filled, totalFields: fields.length };
}

function _scoreConfidence(opp) {
  // Confidence comes from the source's own confidence or defaults high
  if (typeof opp.confidence_score === 'number') {
    return { score: Math.round(opp.confidence_score * 100), source: 'provided' };
  }
  // No confidence provided — moderate default
  return { score: 60, source: 'default' };
}

/**
 * Qualify a batch of opportunities
 * @param {Array} opportunities
 * @param {Object} config
 * @returns {Object} { qualified, needsReview, rejected }
 */
function qualifyOpportunities(opportunities, config = {}) {
  const qualified = [];
  const needsReview = [];
  const rejected = [];

  for (const opp of opportunities) {
    const result = scoreOpportunity(opp, config);
    const scored = {
      ...opp,
      qualification_score: result.score,
      scoring_reasons: result.reasons,
      status: result.status,
      updated_at: new Date().toISOString()
    };

    if (result.status === OPPORTUNITY_STATUSES.QUALIFIED) qualified.push(scored);
    else if (result.status === OPPORTUNITY_STATUSES.NEEDS_REVIEW) needsReview.push(scored);
    else rejected.push(scored);
  }

  return { qualified, needsReview, rejected };
}

module.exports = {
  scoreOpportunity,
  qualifyOpportunities,
  DEFAULT_WEIGHTS,
  DEFAULT_CONFIG,
  // Exported for testing
  _scoreContentFit,
  _scoreBudgetFit,
  _scoreServiceFit,
  _scoreUrgency,
  _scoreCompleteness,
  _scoreConfidence
};
