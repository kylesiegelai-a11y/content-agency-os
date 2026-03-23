/**
 * Scope Creep Detector
 * Analyzes revision requests against original brief
 * Detects out-of-scope additions and generates change orders
 */

const logger = require('./logger');

class ScopeCreepDetector {
  constructor(apiClient, config = {}) {
    this.apiClient = apiClient;
    this.config = config;
    this.detectionHistory = [];
    this.metrics = {
      totalChecks: 0,
      scopeCreepDetected: 0,
      changeOrdersGenerated: 0,
      upsellAttempts: 0,
      successfulUpsells: 0
    };
  }

  /**
   * Analyze revision request against original scope
   * @param {Object} originalBrief - Original project brief/proposal
   * @param {Object} revisionRequest - Client revision request
   * @returns {Object} Detection result with change order if scope creep detected
   */
  async analyzeRevisionRequest(originalBrief, revisionRequest) {
    this.metrics.totalChecks++;

    try {
      if (!originalBrief || !revisionRequest) {
        throw new Error('Invalid brief or revision request provided');
      }

      // Step 1: Extract key attributes from brief
      const briefScope = this._extractScopeAttributes(originalBrief);

      // Step 2: Extract requested changes
      const requestedChanges = this._extractRequestedChanges(revisionRequest);

      // Step 3: Analyze scope creep using comparison logic
      const scopeAnalysis = this._compareScopes(briefScope, requestedChanges);

      // Step 4: Use AI for semantic analysis (simulated - in production use apiClient)
      const aiAnalysis = await this._performSemanticAnalysis(
        briefScope,
        requestedChanges
      );

      // Step 5: Combine analyses
      const isScopeCreep = scopeAnalysis.hasScopeCreep || aiAnalysis.isScopeCreep;

      if (isScopeCreep) {
        this.metrics.scopeCreepDetected++;

        // Generate change order
        const changeOrder = this._generateChangeOrder(
          originalBrief,
          requestedChanges,
          scopeAnalysis,
          aiAnalysis
        );

        // Log upsell attempt
        this.metrics.upsellAttempts++;
        this._logUpsellAttempt(originalBrief, changeOrder);

        return {
          is_scope_creep: true,
          confidence: this._calculateConfidence(scopeAnalysis, aiAnalysis),
          original_scope: briefScope,
          requested_additions: requestedChanges.additions,
          scope_impact: scopeAnalysis.impactSummary,
          change_order: changeOrder,
          recommendation: 'CHARGE_CHANGE_ORDER',
          timestamp: new Date()
        };
      } else {
        return {
          is_scope_creep: false,
          confidence: 1.0,
          original_scope: briefScope,
          requested_additions: requestedChanges.additions,
          scope_impact: 'WITHIN_ORIGINAL_SCOPE',
          change_order: null,
          recommendation: 'APPROVE_AT_NO_ADDITIONAL_COST',
          timestamp: new Date()
        };
      }
    } catch (error) {
      logger.error(`Scope creep detection error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Extract scope attributes from original brief
   * @private
   */
  _extractScopeAttributes(brief) {
    return {
      projectId: brief.id || brief.jobId || brief.projectId,
      title: brief.title || brief.projectTitle || '',
      description: brief.description || brief.requirements || '',
      deliverables: Array.isArray(brief.deliverables)
        ? brief.deliverables
        : [brief.deliverables || ''],
      revisionRounds: brief.revisionRounds || brief.revisions || 2,
      wordCount: brief.wordCount || this._estimateWordCount(brief.description),
      sections: this._extractSections(brief.description),
      inclusions: [
        'Content creation',
        'Initial revisions (up to ' + (brief.revisionRounds || 2) + ' rounds)',
        'Final delivery'
      ],
      exclusions: brief.exclusions || [
        'Graphics/design work',
        'Video content',
        'Audio/voiceover',
        'Additional research beyond proposal scope',
        'Marketing/promotion beyond content'
      ],
      timeline: brief.timeline || brief.deadline,
      budget: brief.budget || brief.pricing?.total || 0
    };
  }

  /**
   * Extract requested changes from revision request
   * @private
   */
  _extractRequestedChanges(request) {
    const additions = [];

    // Parse request text
    const requestText = typeof request === 'string'
      ? request
      : request.message || request.description || JSON.stringify(request);

    // Check for common scope creep indicators
    const scopeCreepPatterns = [
      { pattern: /add.*section|new section/i, type: 'additional_section', weight: 0.8 },
      { pattern: /additional.*page|more.*content/i, type: 'extended_content', weight: 0.7 },
      { pattern: /more.*revision|extra.*revision/i, type: 'extra_revisions', weight: 0.9 },
      { pattern: /include.*graphic|design.*element|image|video/i, type: 'multimedia', weight: 1.0 },
      { pattern: /research|case study|data analysis/i, type: 'additional_research', weight: 0.8 },
      { pattern: /rush|urgent|expedited/i, type: 'rush_delivery', weight: 0.6 },
      { pattern: /multiple niche|different perspective|rewrite/i, type: 'major_revision', weight: 0.85 },
      { pattern: /competitor analysis|market research/i, type: 'strategic_analysis', weight: 0.9 },
      { pattern: /separate document|multiple format|redesign/i, type: 'format_expansion', weight: 0.8 },
      { pattern: /SEO optimization|keyword|technical/i, type: 'technical_additions', weight: 0.7 }
    ];

    let scopeCreepScore = 0;

    for (const { pattern, type, weight } of scopeCreepPatterns) {
      if (pattern.test(requestText)) {
        additions.push({
          type,
          detected: true,
          weight,
          evidence: requestText.substring(0, 100)
        });
        scopeCreepScore += weight;
      }
    }

    return {
      additions,
      totalDetected: additions.length,
      scopeCreepScore: Math.min(scopeCreepScore, 5),
      rawRequest: requestText
    };
  }

  /**
   * Compare original scope with requested changes
   * @private
   */
  _compareScopes(briefScope, requestedChanges) {
    const hasScopeCreep = requestedChanges.additions.length > 0;

    const impactSummary = {
      additionalSections: requestedChanges.additions.filter(a => a.type === 'additional_section').length,
      extendedContent: requestedChanges.additions.filter(a => a.type === 'extended_content').length,
      extraRevisions: requestedChanges.additions.filter(a => a.type === 'extra_revisions').length,
      multimediaRequests: requestedChanges.additions.filter(a => a.type === 'multimedia').length,
      additionalResearch: requestedChanges.additions.filter(a => a.type === 'additional_research').length,
      majorRevisions: requestedChanges.additions.filter(a => a.type === 'major_revision').length
    };

    // Calculate effort multiplier
    let effortMultiplier = 1.0;

    if (impactSummary.additionalSections > 0) effortMultiplier += 0.3;
    if (impactSummary.extendedContent > 0) effortMultiplier += 0.2;
    if (impactSummary.extraRevisions > 0) effortMultiplier += 0.25;
    if (impactSummary.multimediaRequests > 0) effortMultiplier += 0.5;
    if (impactSummary.additionalResearch > 0) effortMultiplier += 0.4;
    if (impactSummary.majorRevisions > 0) effortMultiplier += 0.6;

    return {
      hasScopeCreep,
      impactSummary,
      effortMultiplier: parseFloat(effortMultiplier.toFixed(2)),
      summary: this._summarizeImpact(impactSummary)
    };
  }

  /**
   * Perform semantic analysis (simulated AI analysis)
   * @private
   */
  async _performSemanticAnalysis(briefScope, requestedChanges) {
    // Simulated AI analysis - in production, use apiClient
    try {
      // Check if changes are fundamentally out of scope
      const typeConflicts = requestedChanges.additions.filter(
        add => briefScope.exclusions.some(excl => excl.toLowerCase().includes(add.type.split('_')[0]))
      );

      const isScopeCreep = typeConflicts.length > 0 || requestedChanges.scopeCreepScore >= 2;

      return {
        isScopeCreep,
        typeConflicts,
        semanticScore: parseFloat((requestedChanges.scopeCreepScore / 5).toFixed(2)),
        analysis: 'Semantic analysis completed',
        timestamp: new Date()
      };
    } catch (error) {
      logger.warn(`Semantic analysis warning: ${error.message}`);
      // Fail safely - if unsure, don't flag as scope creep
      return {
        isScopeCreep: false,
        typeConflicts: [],
        semanticScore: 0,
        analysis: 'Analysis inconclusive',
        timestamp: new Date()
      };
    }
  }

  /**
   * Generate change order for out-of-scope work
   * @private
   */
  _generateChangeOrder(originalBrief, requestedChanges, scopeAnalysis, aiAnalysis) {
    const basePrice = originalBrief.budget || originalBrief.pricing?.total || 1500;
    const additionalCost = this._calculateAdditionalCost(
      basePrice,
      scopeAnalysis.effortMultiplier,
      requestedChanges
    );

    const changeOrder = {
      id: `co_${Date.now()}`,
      projectId: originalBrief.id || originalBrief.jobId,
      changeDate: new Date(),
      originalBudget: basePrice,
      changeDescription: this._generateChangeDescription(requestedChanges),
      scopeAdditions: requestedChanges.additions,
      effortMultiplier: scopeAnalysis.effortMultiplier,
      ratePerHour: 75, // Standard rate
      estimatedAdditionalHours: Math.ceil((additionalCost / 75)),
      additionalCost: parseFloat(additionalCost.toFixed(2)),
      newTotalBudget: parseFloat((basePrice + additionalCost).toFixed(2)),
      costBreakdown: this._generateCostBreakdown(requestedChanges, additionalCost),
      terms: {
        paymentTiming: 'Before revision work begins',
        revision: 'Change order must be signed before proceeding',
        timeline: 'Additional 3-5 business days for out-of-scope work'
      },
      confidence: this._calculateConfidence(scopeAnalysis, aiAnalysis),
      status: 'draft',
      readyForApproval: true
    };

    return changeOrder;
  }

  /**
   * Calculate additional cost for out-of-scope work
   * @private
   */
  _calculateAdditionalCost(basePrice, effortMultiplier, requestedChanges) {
    const effortIncrease = basePrice * (effortMultiplier - 1);
    const scopeCreepFactor = Math.min(requestedChanges.additions.length * 150, basePrice * 0.5);

    return Math.max(effortIncrease, scopeCreepFactor);
  }

  /**
   * Generate human-readable change description
   * @private
   */
  _generateChangeDescription(requestedChanges) {
    const items = [];

    if (requestedChanges.additions.length === 0) {
      return 'No changes requested';
    }

    requestedChanges.additions.forEach(add => {
      items.push(`• ${add.type.replace(/_/g, ' ')}`);
    });

    return items.join('\n');
  }

  /**
   * Generate cost breakdown
   * @private
   */
  _generateCostBreakdown(requestedChanges, totalAdditionalCost) {
    const breakdown = {};
    const typeWeights = {};

    // Calculate weights for each type
    requestedChanges.additions.forEach(add => {
      typeWeights[add.type] = (typeWeights[add.type] || 0) + add.weight;
    });

    const totalWeight = Object.values(typeWeights).reduce((a, b) => a + b, 0);

    // Allocate costs by weight
    Object.entries(typeWeights).forEach(([type, weight]) => {
      breakdown[type] = parseFloat((totalAdditionalCost * (weight / totalWeight)).toFixed(2));
    });

    return breakdown;
  }

  /**
   * Calculate confidence score
   * @private
   */
  _calculateConfidence(scopeAnalysis, aiAnalysis) {
    const scopeScore = scopeAnalysis.effortMultiplier > 1.0 ? 0.9 : 0.3;
    const aiScore = aiAnalysis.semanticScore || 0;

    return parseFloat(((scopeScore + aiScore) / 2).toFixed(2));
  }

  /**
   * Estimate word count from description
   * @private
   */
  _estimateWordCount(description) {
    if (!description) return 2000;
    const words = description.split(/\s+/).length;
    return Math.max(words, 2000);
  }

  /**
   * Extract sections from description
   * @private
   */
  _extractSections(description) {
    if (!description) return [];

    const sectionPatterns = [
      { pattern: /introduction|overview|executive summary/i, name: 'Introduction' },
      { pattern: /content|body|main/i, name: 'Main Content' },
      { pattern: /conclusion|summary|recommendations/i, name: 'Conclusion' },
      { pattern: /case study|example/i, name: 'Case Studies' },
      { pattern: /research|analysis|data/i, name: 'Research' }
    ];

    return sectionPatterns
      .filter(item => item.pattern.test(description))
      .map(item => item.name);
  }

  /**
   * Summarize impact of scope creep
   * @private
   */
  _summarizeImpact(impactSummary) {
    const impacts = [];

    if (impactSummary.additionalSections > 0) {
      impacts.push(`${impactSummary.additionalSections} additional sections`);
    }
    if (impactSummary.extendedContent > 0) {
      impacts.push(`Extended content requests`);
    }
    if (impactSummary.extraRevisions > 0) {
      impacts.push(`${impactSummary.extraRevisions} additional revision rounds`);
    }
    if (impactSummary.multimediaRequests > 0) {
      impacts.push(`Multimedia/design work`);
    }
    if (impactSummary.additionalResearch > 0) {
      impacts.push(`Additional research required`);
    }

    return impacts.length > 0
      ? impacts.join('; ')
      : 'No significant scope impact';
  }

  /**
   * Log upsell attempt
   * @private
   */
  _logUpsellAttempt(originalBrief, changeOrder) {
    this.detectionHistory.push({
      projectId: originalBrief.id || originalBrief.jobId,
      clientName: originalBrief.clientName,
      originalBudget: originalBrief.budget || originalBrief.pricing?.total,
      changeOrderAmount: changeOrder.additionalCost,
      changeOrderId: changeOrder.id,
      timestamp: new Date(),
      status: 'pending_approval'
    });

    logger.info(
      `[ScopeCreepDetector] Upsell attempt logged: $${changeOrder.additionalCost} for project ${originalBrief.id}`
    );
  }

  /**
   * Get detection history
   */
  getDetectionHistory(limit = 50) {
    return this.detectionHistory.slice(-limit).reverse();
  }

  /**
   * Get metrics
   */
  getMetrics() {
    const successRate = this.metrics.upsellAttempts > 0
      ? (this.metrics.successfulUpsells / this.metrics.upsellAttempts * 100).toFixed(1)
      : 0;

    return {
      totalChecks: this.metrics.totalChecks,
      scopeCreepDetected: this.metrics.scopeCreepDetected,
      detectionRate: ((this.metrics.scopeCreepDetected / Math.max(this.metrics.totalChecks, 1)) * 100).toFixed(1) + '%',
      changeOrdersGenerated: this.metrics.changeOrdersGenerated,
      upsellAttempts: this.metrics.upsellAttempts,
      successfulUpsells: this.metrics.successfulUpsells,
      successRate: `${successRate}%`,
      timestamp: new Date()
    };
  }

  /**
   * Record successful upsell
   */
  recordSuccessfulUpsell(changeOrderId) {
    this.metrics.successfulUpsells++;
    const history = this.detectionHistory.find(item => item.changeOrderId === changeOrderId);
    if (history) {
      history.status = 'approved';
    }
    logger.info(`[ScopeCreepDetector] Upsell successful: ${changeOrderId}`);
  }

  /**
   * Clear detection history (for testing)
   */
  clearHistory() {
    this.detectionHistory = [];
  }
}

module.exports = ScopeCreepDetector;
