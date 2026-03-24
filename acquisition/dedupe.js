/**
 * Opportunity Deduplication
 * Deterministic cross-source deduplication using normalized keys.
 */

const crypto = require('crypto');
const { OPPORTUNITY_STATUSES } = require('./opportunitySchema');

/**
 * Generate a dedupe key from an opportunity
 * Uses a combination of: normalized email, company, title, source_record_id
 */
function generateDedupeKey(opp) {
  const parts = [
    (opp.client_email || '').toLowerCase().trim(),
    (opp.company_name || '').toLowerCase().trim().replace(/\s+/g, ' '),
    (opp.title || '').toLowerCase().trim().replace(/\s+/g, ' ').substring(0, 100)
  ].filter(p => p.length > 0);

  if (parts.length === 0) {
    // Fallback: hash of raw payload
    if (opp.raw_payload) {
      return 'raw:' + crypto.createHash('sha256').update(JSON.stringify(opp.raw_payload)).digest('hex').substring(0, 16);
    }
    return 'id:' + opp.id;
  }

  const joined = parts.join('|');
  return crypto.createHash('sha256').update(joined).digest('hex').substring(0, 24);
}

/**
 * Compute similarity between two opportunities (0-1)
 */
function computeSimilarity(a, b) {
  let score = 0;
  let factors = 0;

  // Email match (strong signal)
  if (a.client_email && b.client_email) {
    factors++;
    if (a.client_email.toLowerCase().trim() === b.client_email.toLowerCase().trim()) {
      score += 1.0;
    }
  }

  // Company match
  if (a.company_name && b.company_name) {
    factors++;
    const aNorm = a.company_name.toLowerCase().trim();
    const bNorm = b.company_name.toLowerCase().trim();
    if (aNorm === bNorm) score += 1.0;
    else if (aNorm.includes(bNorm) || bNorm.includes(aNorm)) score += 0.7;
  }

  // Title similarity (Jaccard on words)
  if (a.title && b.title) {
    factors++;
    const aWords = new Set(a.title.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const bWords = new Set(b.title.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    if (aWords.size > 0 && bWords.size > 0) {
      const intersection = new Set([...aWords].filter(x => bWords.has(x)));
      const union = new Set([...aWords, ...bWords]);
      score += intersection.size / union.size;
    }
  }

  // Source record ID match (exact match = definite dupe)
  if (a.source_record_id && b.source_record_id && a.source_record_id === b.source_record_id) {
    return 1.0;
  }

  return factors > 0 ? score / factors : 0;
}

/**
 * Deduplicate a batch of opportunities against existing ones
 * @param {Array} newOpportunities - Incoming opportunities
 * @param {Array} existingOpportunities - Already-persisted opportunities
 * @param {Object} options - { similarityThreshold: 0.8 }
 * @returns {Object} { unique, duplicates, dedupeReport }
 */
function dedupeOpportunities(newOpportunities, existingOpportunities = [], options = {}) {
  const threshold = options.similarityThreshold || 0.8;
  const unique = [];
  const duplicates = [];
  const dedupeReport = [];

  // Build dedupe key index from existing
  const existingKeys = new Map();
  for (const existing of existingOpportunities) {
    const key = existing.dedupe_key || generateDedupeKey(existing);
    existingKeys.set(key, existing);
  }

  // Track keys within this batch too
  const batchKeys = new Map();

  for (const opp of newOpportunities) {
    const key = generateDedupeKey(opp);
    opp.dedupe_key = key;

    // Exact key match against existing
    if (existingKeys.has(key)) {
      duplicates.push({ ...opp, status: OPPORTUNITY_STATUSES.DUPLICATE, review_reason: 'Exact dedupe key match with existing opportunity' });
      dedupeReport.push({ id: opp.id, key, type: 'exact_existing', matchedId: existingKeys.get(key).id });
      continue;
    }

    // Exact key match within batch
    if (batchKeys.has(key)) {
      duplicates.push({ ...opp, status: OPPORTUNITY_STATUSES.DUPLICATE, review_reason: 'Exact dedupe key match within import batch' });
      dedupeReport.push({ id: opp.id, key, type: 'exact_batch', matchedId: batchKeys.get(key).id });
      continue;
    }

    // Fuzzy similarity check against existing
    let isDupe = false;
    for (const existing of existingOpportunities) {
      const similarity = computeSimilarity(opp, existing);
      if (similarity >= threshold) {
        duplicates.push({ ...opp, status: OPPORTUNITY_STATUSES.DUPLICATE, review_reason: `Fuzzy match (${(similarity * 100).toFixed(0)}%) with existing opportunity ${existing.id}` });
        dedupeReport.push({ id: opp.id, key, type: 'fuzzy_existing', matchedId: existing.id, similarity });
        isDupe = true;
        break;
      }
    }

    if (!isDupe) {
      batchKeys.set(key, opp);
      unique.push(opp);
      dedupeReport.push({ id: opp.id, key, type: 'unique' });
    }
  }

  return {
    unique,
    duplicates,
    stats: {
      total: newOpportunities.length,
      unique: unique.length,
      duplicates: duplicates.length,
      exactMatches: dedupeReport.filter(r => r.type.startsWith('exact')).length,
      fuzzyMatches: dedupeReport.filter(r => r.type === 'fuzzy_existing').length
    },
    dedupeReport
  };
}

module.exports = {
  generateDedupeKey,
  computeSimilarity,
  dedupeOpportunities
};
