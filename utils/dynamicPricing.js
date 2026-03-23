/**
 * Dynamic Pricing Engine
 * Calculates pricing tiers based on review count and niche demand
 * Implements introductory, standard, and premium pricing strategies
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class DynamicPricing {
  constructor(config = {}) {
    this.config = config;
    this.ledgerPath = config.ledgerPath || path.join(__dirname, '../data/ledger.json');
    this.configPath = config.configPath || path.join(__dirname, '../config.json');
    this.nichesPath = config.nichesPath || path.join(__dirname, '../data/niches.json');

    this.pricingConfig = this.loadPricingConfig();
    this.nichesData = this.loadNichesData();

    // Pricing tier definitions
    this.tiers = {
      introductory: {
        name: 'Introductory',
        minReviews: 0,
        maxReviews: 2,
        baseMultiplier: 0.7, // 30% discount
        description: 'New to platform - building credibility'
      },
      standard: {
        name: 'Standard',
        minReviews: 3,
        maxReviews: 9,
        baseMultiplier: 1.0, // Standard pricing
        description: 'Established with multiple reviews'
      },
      premium: {
        name: 'Premium',
        minReviews: 10,
        maxReviews: Infinity,
        baseMultiplier: 1.4, // 40% premium
        description: 'Highly experienced with strong reputation'
      }
    };

    this.demandFactors = {
      highDemand: 1.25, // 25% increase
      mediumDemand: 1.0, // Standard rate
      lowDemand: 0.85 // 15% decrease
    };

    this.pricingHistory = [];
  }

  /**
   * Load pricing configuration from config.json
   */
  loadPricingConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const configData = fs.readFileSync(this.configPath, 'utf8');
        const config = JSON.parse(configData);
        return config.pricing_tiers || this._getDefaultPricingTiers();
      }
      return this._getDefaultPricingTiers();
    } catch (error) {
      logger.warn(`Failed to load pricing config: ${error.message}`);
      return this._getDefaultPricingTiers();
    }
  }

  /**
   * Default pricing tiers
   */
  _getDefaultPricingTiers() {
    return {
      introductory: {
        name: 'Introductory',
        monthly_cost: 49,
        monthly_jobs: 5,
        perJobCost: 1500
      },
      standard: {
        name: 'Standard',
        monthly_cost: 149,
        monthly_jobs: 20,
        perJobCost: 2000
      },
      premium: {
        name: 'Premium',
        monthly_cost: 299,
        monthly_jobs: 50,
        perJobCost: 2800
      }
    };
  }

  /**
   * Load niches data for demand analysis
   */
  loadNichesData() {
    try {
      if (fs.existsSync(this.nichesPath)) {
        const nichesData = fs.readFileSync(this.nichesPath, 'utf8');
        return JSON.parse(nichesData);
      }
      return { niches: [], outcomes: [] };
    } catch (error) {
      logger.warn(`Failed to load niches data: ${error.message}`);
      return { niches: [], outcomes: [] };
    }
  }

  /**
   * Get current review count from ledger
   */
  getReviewCount() {
    try {
      if (!fs.existsSync(this.ledgerPath)) {
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
      logger.error(`Failed to read review count: ${error.message}`);
      return 0;
    }
  }

  /**
   * Determine pricing tier based on review count
   */
  determineTier(reviewCount = null) {
    if (reviewCount === null) {
      reviewCount = this.getReviewCount();
    }

    if (reviewCount < 3) {
      return 'introductory';
    } else if (reviewCount < 10) {
      return 'standard';
    } else {
      return 'premium';
    }
  }

  /**
   * Analyze niche demand level
   * @private
   */
  _analyzNicheDemand(niche) {
    if (!this.nichesData || !this.nichesData.outcomes) {
      return 'mediumDemand';
    }

    // Count successful outcomes in this niche
    const nicheOutcomes = this.nichesData.outcomes.filter(o => o.niche === niche);

    if (nicheOutcomes.length === 0) {
      return 'mediumDemand';
    }

    // Calculate demand based on success rate
    const successRate = nicheOutcomes.filter(o => o.status === 'success').length / nicheOutcomes.length;

    if (successRate >= 0.75) {
      return 'highDemand';
    } else if (successRate >= 0.5) {
      return 'mediumDemand';
    } else {
      return 'lowDemand';
    }
  }

  /**
   * Calculate pricing for a project
   * @param {Object} options - Pricing options { niche, basePrice, reviewCount, customFactors }
   * @returns {Object} Pricing calculation result
   */
  calculatePrice(options = {}) {
    const {
      niche = 'general',
      basePrice = 2000,
      reviewCount = null,
      customFactors = []
    } = options;

    try {
      // Get current review count if not provided
      const currentReviewCount = reviewCount !== null ? reviewCount : this.getReviewCount();

      // Step 1: Determine tier
      const tierName = this.determineTier(currentReviewCount);
      const tier = this.tiers[tierName];

      // Step 2: Get tier multiplier
      const tierMultiplier = tier.baseMultiplier;

      // Step 3: Analyze niche demand
      const demandLevel = this._analyzNicheDemand(niche);
      const demandMultiplier = this.demandFactors[demandLevel];

      // Step 4: Apply custom factors
      let customMultiplier = 1.0;
      if (Array.isArray(customFactors)) {
        customMultiplier = customFactors.reduce((acc, factor) => {
          if (typeof factor === 'number') {
            return acc * factor;
          }
          return acc;
        }, 1.0);
      }

      // Step 5: Calculate adjusted price
      const adjustedPrice = Math.round(
        basePrice * tierMultiplier * demandMultiplier * customMultiplier
      );

      // Step 6: Calculate factors applied
      const factors = {
        baseTier: {
          name: tier.name,
          multiplier: tierMultiplier,
          reviewCount: currentReviewCount,
          description: tier.description
        },
        nicheDemand: {
          level: demandLevel,
          multiplier: demandMultiplier,
          niche,
          analysis: `${demandLevel.replace('Demand', '')} demand for ${niche}`
        },
        customFactors: {
          count: customFactors.length,
          multiplier: customMultiplier
        }
      };

      const result = {
        tier: tierName,
        base_price: basePrice,
        base_price_currency: 'USD',
        adjusted_price: adjustedPrice,
        pricing_increase: adjustedPrice - basePrice,
        pricing_increase_percent: parseFloat(
          (((adjustedPrice - basePrice) / basePrice) * 100).toFixed(1)
        ),
        factors,
        breakdown: {
          basePrice,
          afterTierMultiplier: Math.round(basePrice * tierMultiplier),
          afterDemandAdjustment: Math.round(basePrice * tierMultiplier * demandMultiplier),
          finalPrice: adjustedPrice
        },
        recommendation: this._getPricingRecommendation(tierName, currentReviewCount),
        timestamp: new Date()
      };

      // Log pricing calculation
      this.pricingHistory.push(result);

      return result;
    } catch (error) {
      logger.error(`Pricing calculation error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get pricing recommendation
   * @private
   */
  _getPricingRecommendation(tierName, reviewCount) {
    if (tierName === 'introductory') {
      return {
        action: 'MAINTAIN_LOW_PRICING',
        message: `At ${reviewCount} reviews. Focus on accumulating testimonials and case studies. Target 3+ reviews to transition to standard pricing.`,
        nextMilestone: `3 reviews for standard tier`,
        strategy: 'Build credibility through introductory pricing'
      };
    } else if (tierName === 'standard') {
      return {
        action: 'MAINTAIN_STANDARD_PRICING',
        message: `At ${reviewCount} reviews. Established position with proven track record. Target 10+ reviews for premium positioning.`,
        nextMilestone: `10 reviews for premium tier`,
        strategy: 'Emphasize portfolio and testimonials'
      };
    } else {
      return {
        action: 'PREMIUM_PRICING_ENABLED',
        message: `At ${reviewCount} reviews. Premium positioning justified. Leverage strong reputation in proposals.`,
        nextMilestone: `Maintain 10+ reviews for premium status`,
        strategy: 'Position as expert, command premium rates'
      };
    }
  }

  /**
   * Get tiered pricing options for client quotes
   * @param {Object} options - Base options
   * @returns {Array} Array of pricing tiers for selection
   */
  getTieredPricingOptions(options = {}) {
    const { basePrice = 2000, niche = 'general' } = options;
    const currentReviewCount = this.getReviewCount();
    const currentTier = this.determineTier(currentReviewCount);

    const demandLevel = this._analyzNicheDemand(niche);
    const demandMultiplier = this.demandFactors[demandLevel];

    const options_list = [];

    // Show all available tiers
    for (const [tierKey, tierConfig] of Object.entries(this.tiers)) {
      const tierPrice = Math.round(basePrice * tierConfig.baseMultiplier * demandMultiplier);

      options_list.push({
        tier: tierKey,
        name: tierConfig.name,
        basePrice,
        tierPrice,
        multiplier: tierConfig.baseMultiplier,
        demandAdjustment: demandMultiplier,
        finalPrice: tierPrice,
        available: tierKey === currentTier || tierKey === 'introductory',
        current: tierKey === currentTier,
        description: tierConfig.description,
        reviewRequirement: `${tierConfig.minReviews}-${tierConfig.maxReviews === Infinity ? '∞' : tierConfig.maxReviews} reviews`,
        features: this._getTierFeatures(tierKey),
        recommended: tierKey === currentTier
      });
    }

    return options_list;
  }

  /**
   * Get features for pricing tier
   * @private
   */
  _getTierFeatures(tierName) {
    const features = {
      introductory: [
        'Competitive introductory rates',
        'Full service portfolio',
        'Standard revisions (2 rounds)',
        'Email support',
        'Portfolio showcase eligibility',
        'Testimonial collection'
      ],
      standard: [
        'Established market rates',
        'Premium support',
        'Expanded revisions (3 rounds)',
        'Faster turnaround',
        'Case study development',
        'Niche specialization options'
      ],
      premium: [
        'Premium rates',
        'VIP support',
        'Unlimited revisions (negotiated)',
        'Priority scheduling',
        'Strategic advisory included',
        'Custom solutions',
        'Enterprise pricing available'
      ]
    };

    return features[tierName] || [];
  }

  /**
   * Calculate volume discounts
   */
  calculateVolumeDiscount(basePrice, projectCount) {
    let discountRate = 0;

    if (projectCount >= 10) {
      discountRate = 0.15; // 15% discount for 10+ projects
    } else if (projectCount >= 5) {
      discountRate = 0.1; // 10% discount for 5-9 projects
    } else if (projectCount >= 3) {
      discountRate = 0.05; // 5% discount for 3-4 projects
    }

    const discountAmount = Math.round(basePrice * discountRate);
    const discountedPrice = basePrice - discountAmount;

    return {
      basePrice,
      projectCount,
      discountRate: parseFloat((discountRate * 100).toFixed(1)) + '%',
      discountAmount,
      discountedPrice,
      savings: discountAmount,
      message: projectCount >= 10
        ? 'Bulk pricing applied - 15% discount'
        : projectCount >= 5
        ? 'Volume pricing applied - 10% discount'
        : projectCount >= 3
        ? 'Multiple project discount - 5% discount'
        : 'No volume discount applicable'
    };
  }

  /**
   * Get pricing history
   */
  getPricingHistory(limit = 50) {
    return this.pricingHistory.slice(-limit).reverse();
  }

  /**
   * Get pricing analytics
   */
  getAnalytics() {
    const currentReviewCount = this.getReviewCount();
    const currentTier = this.determineTier(currentReviewCount);

    const averagePrice = this.pricingHistory.length > 0
      ? Math.round(
        this.pricingHistory.reduce((sum, p) => sum + p.adjusted_price, 0) /
        this.pricingHistory.length
      )
      : 0;

    const tierDistribution = {
      introductory: this.pricingHistory.filter(p => p.tier === 'introductory').length,
      standard: this.pricingHistory.filter(p => p.tier === 'standard').length,
      premium: this.pricingHistory.filter(p => p.tier === 'premium').length
    };

    const highestPrice = this.pricingHistory.length > 0
      ? Math.max(...this.pricingHistory.map(p => p.adjusted_price))
      : 0;

    const lowestPrice = this.pricingHistory.length > 0
      ? Math.min(...this.pricingHistory.map(p => p.adjusted_price))
      : 0;

    return {
      currentReviewCount,
      currentTier,
      totalCalculations: this.pricingHistory.length,
      averagePrice,
      priceRange: {
        lowest: lowestPrice,
        highest: highestPrice,
        spread: highestPrice - lowestPrice
      },
      tierDistribution,
      nextMilestone: currentReviewCount < 3
        ? `${3 - currentReviewCount} reviews to standard tier`
        : currentReviewCount < 10
        ? `${10 - currentReviewCount} reviews to premium tier`
        : 'Premium tier maintained',
      timestamp: new Date()
    };
  }

  /**
   * Export pricing model
   */
  exportPricingModel() {
    return {
      tiers: this.tiers,
      demandFactors: this.demandFactors,
      pricingConfig: this.pricingConfig,
      currentState: {
        reviewCount: this.getReviewCount(),
        currentTier: this.determineTier(),
        timestamp: new Date()
      }
    };
  }

  /**
   * Clear history (for testing)
   */
  clearHistory() {
    this.pricingHistory = [];
  }
}

module.exports = DynamicPricing;
