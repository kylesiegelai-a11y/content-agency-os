/**
 * Cold Start Manager
 * Analyzes Upwork review count from ledger and determines optimal strategy
 * Manages transition from cold outreach to balanced prospecting
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class ColdStartManager {
  constructor(config = {}) {
    this.config = config;
    this.ledgerPath = config.ledgerPath || path.join(__dirname, '../data/ledger.json');
    this.strategyState = null;
    this.lastCheckedAt = null;
    this.reviewCountThreshold = config.reviewCountThreshold || 3;
    this.metrics = {
      coldOutreachEmails: 0,
      upworkProposals: 0,
      coldOutreachResponses: 0,
      upworkWins: 0,
      transitions: []
    };
  }

  /**
   * Read review count from ledger.json
   * @returns {number} Number of Upwork reviews
   */
  getUpworkReviewCount() {
    try {
      if (!fs.existsSync(this.ledgerPath)) {
        logger.warn(`Ledger file not found: ${this.ledgerPath}`);
        return 0;
      }

      const ledgerData = fs.readFileSync(this.ledgerPath, 'utf8');
      const ledger = JSON.parse(ledgerData);

      // Count reviews in entries
      const reviewCount = ledger.entries
        ? ledger.entries.filter(entry => entry.type === 'upwork_review').length
        : 0;

      return reviewCount;
    } catch (error) {
      logger.error(`Failed to read review count from ledger: ${error.message}`);
      return 0;
    }
  }

  /**
   * Determine current strategy mode based on review count
   * @returns {string} 'cold_outreach' or 'balanced'
   */
  getStrategyMode() {
    const reviewCount = this.getUpworkReviewCount();

    if (reviewCount < this.reviewCountThreshold) {
      return 'cold_outreach';
    } else {
      return 'balanced';
    }
  }

  /**
   * Get comprehensive strategy status and recommendations
   * @returns {Object} Strategy configuration with recommendations
   */
  getStrategyStatus() {
    const reviewCount = this.getUpworkReviewCount();
    const mode = this.getStrategyMode();
    const timestamp = new Date();

    // Check if mode changed
    if (
      this.strategyState &&
      this.strategyState.mode !== mode
    ) {
      this.metrics.transitions.push({
        from: this.strategyState.mode,
        to: mode,
        reviewCount,
        timestamp
      });

      logger.info(
        `[ColdStartManager] Strategy transition: ${this.strategyState.mode} → ${mode} (${reviewCount} reviews)`
      );
    }

    const strategyConfig = this._getStrategyConfig(mode, reviewCount);

    this.strategyState = {
      mode,
      reviewCount,
      threshold: this.reviewCountThreshold,
      timestamp,
      nextTransitionAt: this._calculateNextTransitionTarget(reviewCount),
      ...strategyConfig
    };

    this.lastCheckedAt = timestamp;

    return this.strategyState;
  }

  /**
   * Get strategy configuration for current mode
   * @private
   */
  _getStrategyConfig(mode, reviewCount) {
    if (mode === 'cold_outreach') {
      return {
        primaryChannel: 'cold_outreach',
        secondaryChannel: 'upwork',
        channels: [
          {
            name: 'cold_outreach',
            priority: 'PRIMARY',
            dailyTarget: 15,
            description: 'Direct email outreach to prospects',
            cadence: 'daily',
            researchSource: ['linkedin', 'company_websites', 'cold_lists'],
            successMetrics: {
              responseRate: 0.15,
              qualificationRate: 0.4,
              conversionRate: 0.1
            }
          },
          {
            name: 'upwork',
            priority: 'SECONDARY',
            dailyTarget: 5,
            description: 'Upwork job submissions',
            cadence: 'as_needed',
            focusOn: 'high_budget_jobs',
            successMetrics: {
              bidAcceptance: 0.2,
              conversionRate: 0.15
            }
          }
        ],
        recommendations: [
          'Focus on building credibility through cold outreach',
          'Establish personal brand and reputation',
          'Collect early testimonials from initial cold outreach wins',
          `Transition to balanced mode after reaching ${this.reviewCountThreshold} Upwork reviews`,
          'Document case studies from cold outreach projects',
          'Build email list from successful prospects for future work'
        ],
        emailStrategy: {
          enabled: true,
          dailyEmails: 15,
          templates: [
            'introduction_template',
            'value_proposition_template',
            'case_study_template'
          ],
          followUpSequence: ['Day 3', 'Day 7', 'Day 14'],
          focusNiches: this.config.focusNiches || ['HR', 'PEO', 'benefits', 'compliance']
        },
        goals: {
          shortTerm: 'Generate initial leads and establish reputation',
          mediumTerm: 'Accumulate 3+ Upwork reviews',
          longTerm: 'Transition to balanced, higher-efficiency prospecting'
        },
        estimatedTimeline: {
          daysToThreshold: Math.max(30, (this.reviewCountThreshold - reviewCount) * 10),
          message: `Currently ${reviewCount}/${this.reviewCountThreshold} reviews. Estimated ${Math.max(30, (this.reviewCountThreshold - reviewCount) * 10)} days to transition.`
        }
      };
    } else {
      // Balanced mode
      return {
        primaryChannel: 'upwork',
        secondaryChannel: 'cold_outreach',
        channels: [
          {
            name: 'upwork',
            priority: 'PRIMARY',
            dailyTarget: 20,
            description: 'Primary prospecting on Upwork platform',
            cadence: 'daily',
            strategy: 'target_high_quality_jobs',
            successMetrics: {
              bidAcceptance: 0.25,
              conversionRate: 0.2
            }
          },
          {
            name: 'cold_outreach',
            priority: 'SUPPLEMENTAL',
            dailyTarget: 5,
            description: 'Strategic cold outreach to select prospects',
            cadence: 'weekly',
            focusOn: 'enterprise_clients',
            successMetrics: {
              responseRate: 0.2,
              conversionRate: 0.15
            }
          }
        ],
        recommendations: [
          'Prioritize Upwork submissions with established profile',
          'Use cold outreach strategically for high-value targets',
          'Continue building reputation and reviews on Upwork',
          'Leverage existing reviews in proposal templates',
          'Consider niche specialization for differentiation',
          'Maintain cold outreach for relationship building with enterprise clients'
        ],
        upworkStrategy: {
          enabled: true,
          dailyBids: 20,
          bidQuality: 'high',
          responseTime: 'within_1_hour',
          profileOptimization: true,
          testimonialDisplaying: true,
          focusOn: [
            'high_budget_projects',
            'repeat_clients',
            'niche_specific_work'
          ]
        },
        coldOutreachStrategy: {
          enabled: true,
          targetType: 'enterprise',
          dailyOutreach: 5,
          approach: 'relationship_building',
          cadence: 'weekly'
        },
        goals: {
          shortTerm: 'Maximize Upwork conversion rate',
          mediumTerm: 'Grow to 10+ reviews',
          longTerm: 'Establish premium positioning with diverse revenue streams'
        },
        estimatedTimeline: {
          daysToNextTier: `${this.reviewCountThreshold * 3} days estimated to premium tier (10+ reviews)`,
          message: `Currently ${reviewCount} reviews. At balanced strategy with Upwork primary channel.`
        }
      };
    }
  }

  /**
   * Calculate when next transition should occur
   * @private
   */
  _calculateNextTransitionTarget(currentCount) {
    if (currentCount < this.reviewCountThreshold) {
      return {
        targetReviews: this.reviewCountThreshold,
        reviewsNeeded: this.reviewCountThreshold - currentCount,
        estimatedDaysToGoal: Math.max(30, (this.reviewCountThreshold - currentCount) * 10),
        transitionMode: 'cold_outreach_to_balanced'
      };
    } else {
      const premiumThreshold = 10;
      return {
        targetReviews: premiumThreshold,
        reviewsNeeded: Math.max(0, premiumThreshold - currentCount),
        estimatedDaysToGoal: Math.max(0, (premiumThreshold - currentCount) * 5),
        transitionMode: 'balanced_to_premium'
      };
    }
  }

  /**
   * Get daily action plan based on current strategy
   */
  getDailyActionPlan() {
    const strategy = this.getStrategyStatus();
    const today = new Date().toISOString().split('T')[0];

    return {
      date: today,
      strategy: strategy.mode,
      actions: [
        {
          channel: strategy.primaryChannel,
          target: strategy.channels.find(c => c.name === strategy.primaryChannel).dailyTarget,
          description: strategy.channels.find(c => c.name === strategy.primaryChannel).description,
          priority: 'HIGH'
        },
        {
          channel: strategy.secondaryChannel,
          target: strategy.channels.find(c => c.name === strategy.secondaryChannel).dailyTarget,
          description: strategy.channels.find(c => c.name === strategy.secondaryChannel).description,
          priority: 'MEDIUM'
        }
      ],
      summary: strategy.mode === 'cold_outreach'
        ? `Send ${strategy.emailStrategy.dailyEmails} cold emails + ${strategy.channels[1].dailyTarget} Upwork submissions`
        : `Submit ${strategy.channels[0].dailyTarget} Upwork bids + targeted cold outreach`,
      successCriteria: {
        minimumOutreachAttempts: strategy.channels[0].dailyTarget + strategy.channels[1].dailyTarget,
        qualityFocus: 'Personalized, niche-specific outreach'
      }
    };
  }

  /**
   * Log successful outcome (review, win, etc)
   */
  logOutcome(type, details = {}) {
    if (type === 'upwork_review') {
      this.metrics.upworkWins++;
    } else if (type === 'cold_outreach_email') {
      this.metrics.coldOutreachEmails++;
    } else if (type === 'cold_outreach_response') {
      this.metrics.coldOutreachResponses++;
    }

    logger.info(`[ColdStartManager] Logged outcome: ${type}`, details);

    // Check if strategy should transition
    const newStrategy = this.getStrategyStatus();
    return newStrategy;
  }

  /**
   * Get metrics and analytics
   */
  getMetrics() {
    const reviewCount = this.getUpworkReviewCount();
    const mode = this.getStrategyMode();

    const coldOutreachRate = this.metrics.coldOutreachEmails > 0
      ? (this.metrics.coldOutreachResponses / this.metrics.coldOutreachEmails * 100).toFixed(1)
      : 0;

    const upworkWinRate = this.metrics.coldOutreachEmails + this.metrics.upworkWins > 0
      ? (this.metrics.upworkWins / (this.metrics.coldOutreachEmails + this.metrics.upworkWins) * 100).toFixed(1)
      : 0;

    return {
      currentMode: mode,
      reviewCount,
      threshold: this.reviewCountThreshold,
      outcomes: {
        coldOutreachEmails: this.metrics.coldOutreachEmails,
        coldOutreachResponses: this.metrics.coldOutreachResponses,
        coldOutreachResponseRate: `${coldOutreachRate}%`,
        upworkWins: this.metrics.upworkWins,
        upworkWinRate: `${upworkWinRate}%`
      },
      transitions: this.metrics.transitions,
      lastUpdated: this.lastCheckedAt
    };
  }

  /**
   * Get recommended next steps
   */
  getNextSteps() {
    const strategy = this.getStrategyStatus();
    const reviewCount = this.getUpworkReviewCount();

    if (strategy.mode === 'cold_outreach') {
      return [
        `1. Send ${strategy.emailStrategy.dailyEmails} personalized cold emails`,
        `2. Submit ${strategy.channels[1].dailyTarget} high-quality Upwork proposals`,
        `3. Track responses and conversions`,
        `4. After 3 Upwork reviews, transition to balanced strategy`,
        `5. Estimated: ${strategy.estimatedTimeline.daysToThreshold} days to transition`,
        '6. Focus on quality over quantity in initial phase'
      ];
    } else {
      return [
        `1. Submit ${strategy.channels[0].dailyTarget} Upwork proposals daily`,
        `2. Target high-budget, niche-specific jobs`,
        `3. Selective cold outreach to enterprise prospects (${strategy.channels[1].dailyTarget}/week)`,
        `4. Current reviews: ${reviewCount} (Estimated ${strategy.estimatedTimeline.daysToNextTier})`,
        '5. Optimize Upwork profile for conversions',
        '6. Build testimonials library from projects'
      ];
    }
  }

  /**
   * Reset metrics (for testing)
   */
  resetMetrics() {
    this.metrics = {
      coldOutreachEmails: 0,
      upworkProposals: 0,
      coldOutreachResponses: 0,
      upworkWins: 0,
      transitions: []
    };
  }
}

module.exports = ColdStartManager;
