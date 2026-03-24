/**
 * GmailSource - Parse opportunities from labeled email threads
 */

const AcquisitionSource = require('../AcquisitionSource');
const { SOURCE_TYPES, createOpportunity } = require('../opportunitySchema');

class GmailSource extends AcquisitionSource {
  constructor(gmailService, options = {}) {
    super('gmail', SOURCE_TYPES.GMAIL, options);
    this.gmailService = gmailService;
  }

  /**
   * Fetch opportunities from labeled emails
   * @param {Object} params - { labelName?: string }
   * @returns {Promise<Array<Object>>}
   */
  async fetchOpportunities(params = {}) {
    const labelName = params.labelName || 'Opportunities';

    try {
      if (!this.gmailService || typeof this.gmailService.getThreadsByLabel !== 'function') {
        throw new Error('gmailService must have getThreadsByLabel method');
      }

      const threads = await this.gmailService.getThreadsByLabel(labelName);
      const opportunities = threads
        .map(thread => this.normalizeOpportunity(thread))
        .filter(opp => opp !== null);

      this._recordSuccess(opportunities.length);
      return opportunities;
    } catch (error) {
      this._recordError(error);
      throw error;
    }
  }

  /**
   * Extract budget from text using regex
   * @param {string} text - Text to search
   * @returns {number | null}
   */
  _extractBudget(text) {
    if (!text) return null;

    // Look for patterns like $5000, $5,000, $5-10k, etc.
    const budgetMatch = text.match(/\$([0-9,]+)(?:k|K)?/);
    if (budgetMatch) {
      const amount = budgetMatch[1].replace(/,/g, '');
      const numAmount = parseInt(amount, 10);
      return isNaN(numAmount) ? null : numAmount;
    }

    return null;
  }

  /**
   * Calculate confidence score based on email keywords
   * @param {Object} email - Email object
   * @returns {number} Score from 0 to 1
   */
  _extractConfidence(email) {
    const keywords = ['project', 'budget', 'deadline', 'proposal', 'quote'];
    const text = `${email.subject || ''} ${email.body || ''}`.toLowerCase();

    let matches = 0;
    keywords.forEach(keyword => {
      if (text.includes(keyword)) matches++;
    });

    return Math.min(matches * 0.2, 1.0);
  }

  /**
   * Normalize email to opportunity schema
   * Conservative parsing: only extract when confidence is sufficient
   * @param {Object} email - Raw email object
   * @returns {Object | null} Normalized opportunity or null if insufficient confidence
   */
  normalizeOpportunity(email) {
    if (!email) return null;

    const confidence = this._extractConfidence(email);
    const budget = this._extractBudget(email.body);

    // Extract client info from email headers
    const fromMatch = email.from ? email.from.match(/(.+?)\s*<(.+?)>|(.+)/) : null;
    const clientName = fromMatch ? (fromMatch[1] || fromMatch[3] || '').trim() : '';
    const clientEmail = fromMatch ? (fromMatch[2] || '').trim() : email.from || '';

    const status = confidence >= 0.4 ? 'normalized' : 'needs_review';
    const reviewReason = confidence < 0.4 ? 'Low confidence: insufficient keywords for automatic qualification' : null;

    return createOpportunity({
      id: email.id || `gmail-${email.threadId}`,
      source_type: SOURCE_TYPES.GMAIL,
      source_name: this.name,
      source_record_id: email.id || email.threadId,
      received_at: email.date || new Date().toISOString(),
      title: email.subject || 'Untitled Opportunity',
      description: email.body || '',
      client_name: clientName,
      client_email: clientEmail,
      company_name: email.organization || '',
      budget_min: budget,
      budget_max: null,
      tags: [],
      raw_payload: email,
      confidence_score: confidence,
      status,
      review_reason: reviewReason,
      metadata: {
        email_thread_id: email.threadId,
        email_from: email.from,
        email_date: email.date
      }
    });
  }
}

module.exports = GmailSource;
