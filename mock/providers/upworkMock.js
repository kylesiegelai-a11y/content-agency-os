/**
 * Mock Upwork Provider
 * Reads from mock/test_opportunities.json
 * Returns listings cycling through rotation so prospecting pipeline always has jobs
 */

const fs = require('fs');
const path = require('path');

// Path to test opportunities data
const TEST_OPPORTUNITIES_PATH = path.join(__dirname, '../test_opportunities.json');

/**
 * Default test opportunities if file doesn't exist
 */
const DEFAULT_OPPORTUNITIES = [
  {
    id: 'job_001',
    title: 'Write Technical Blog Posts for SaaS Startup',
    description: 'Looking for experienced content writer to create 4 technical blog posts about cloud infrastructure. Posts should be 2000+ words each, SEO-optimized, and include code examples.',
    niche: 'technology',
    budget: {
      type: 'fixed',
      amount: 2500
    },
    duration: 'less_than_month',
    experience_level: 'intermediate',
    skills: ['technical writing', 'SEO', 'cloud computing'],
    posted_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    client: {
      name: 'TechStart Inc',
      rating: 4.8,
      reviews: 12
    }
  },
  {
    id: 'job_002',
    title: 'Create Marketing Proposal for Enterprise Client',
    description: 'Need compelling marketing proposal for enterprise software solution. Should include market analysis, competitive positioning, and implementation roadmap.',
    niche: 'marketing',
    budget: {
      type: 'fixed',
      amount: 1800
    },
    duration: '1_to_3_months',
    experience_level: 'advanced',
    skills: ['proposal writing', 'marketing strategy', 'business analysis'],
    posted_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    client: {
      name: 'ConsultPro Group',
      rating: 4.6,
      reviews: 28
    }
  },
  {
    id: 'job_003',
    title: 'HR Content: Employee Handbook Updates',
    description: 'Update and expand employee handbook with modern HR policies. Need content writer experienced in HR/employment law to create clear, accessible policy documents.',
    niche: 'human_resources',
    budget: {
      type: 'fixed',
      amount: 1200
    },
    duration: '1_to_3_months',
    experience_level: 'intermediate',
    skills: ['HR writing', 'policy documentation', 'compliance'],
    posted_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    client: {
      name: 'PeopleFirst HR',
      rating: 4.9,
      reviews: 35
    }
  },
  {
    id: 'job_004',
    title: 'Develop Content Strategy for Healthcare Startup',
    description: 'Create comprehensive content strategy for healthcare tech startup. Includes audience research, content calendar, distribution channels, and KPI framework.',
    niche: 'healthcare',
    budget: {
      type: 'hourly',
      rate: 75,
      hours: 40
    },
    duration: '1_to_3_months',
    experience_level: 'advanced',
    skills: ['content strategy', 'healthcare knowledge', 'analytics'],
    posted_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    client: {
      name: 'HealthInnovate Labs',
      rating: 4.7,
      reviews: 18
    }
  },
  {
    id: 'job_005',
    title: 'Email Marketing Campaign Copy',
    description: 'Write email marketing sequences for e-commerce platform. Need 5 email campaigns with subject lines, body copy, and CTAs optimized for conversions.',
    niche: 'ecommerce',
    budget: {
      type: 'fixed',
      amount: 950
    },
    duration: 'less_than_month',
    experience_level: 'intermediate',
    skills: ['copywriting', 'email marketing', 'conversion optimization'],
    posted_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    client: {
      name: 'ShopVibe Commerce',
      rating: 4.5,
      reviews: 22
    }
  },
  {
    id: 'job_006',
    title: 'Financial Services White Paper',
    description: 'Research and write white paper on fintech regulatory compliance. 5000 words, must include case studies and actionable recommendations.',
    niche: 'finance',
    budget: {
      type: 'fixed',
      amount: 3200
    },
    duration: '1_to_3_months',
    experience_level: 'advanced',
    skills: ['technical writing', 'finance', 'research'],
    posted_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    client: {
      name: 'FinServe Consultants',
      rating: 4.8,
      reviews: 41
    }
  },
  {
    id: 'job_007',
    title: 'Real Estate Marketing Materials',
    description: 'Write marketing copy for luxury real estate listings. Need compelling descriptions for 10 high-end properties including buyer personas and value propositions.',
    niche: 'real_estate',
    budget: {
      type: 'fixed',
      amount: 1100
    },
    duration: 'less_than_month',
    experience_level: 'intermediate',
    skills: ['marketing copy', 'luxury brand', 'real estate'],
    posted_at: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
    client: {
      name: 'LuxeProperty Agency',
      rating: 4.6,
      reviews: 15
    }
  },
  {
    id: 'job_008',
    title: 'Legal Document Templates and Guides',
    description: 'Create plain-language guides for legal documents. Convert complex legal language into accessible customer guides (20+ pages total).',
    niche: 'legal',
    budget: {
      type: 'hourly',
      rate: 85,
      hours: 50
    },
    duration: '1_to_3_months',
    experience_level: 'advanced',
    skills: ['legal writing', 'plain language', 'documentation'],
    posted_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    client: {
      name: 'LegalEase Solutions',
      rating: 4.9,
      reviews: 52
    }
  }
];

/**
 * Load test opportunities from file or use defaults
 */
function loadOpportunities() {
  try {
    if (fs.existsSync(TEST_OPPORTUNITIES_PATH)) {
      const data = fs.readFileSync(TEST_OPPORTUNITIES_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.warn(`Could not load test opportunities from ${TEST_OPPORTUNITIES_PATH}:`, error.message);
  }

  return DEFAULT_OPPORTUNITIES;
}

/**
 * Mock Upwork API provider
 */
class UpworkMock {
  constructor(options = {}) {
    this.options = options;
    this.opportunities = loadOpportunities();
    this.currentIndex = 0;
    this.viewedJobs = new Set();
  }

  /**
   * Search for job opportunities
   * Cycles through opportunities to simulate pipeline rotation
   * @param {Object} options - Search options
   * @param {string} options.niche - Filter by niche/category
   * @param {string} options.query - Text search query
   * @param {number} options.limit - Max results to return
   * @returns {Promise<Object>} Search results with jobs
   */
  async searchJobs(options = {}) {
    const { niche, query, limit = 5 } = options;

    let results = [...this.opportunities];

    // Filter by niche if specified
    if (niche) {
      results = results.filter(job => job.niche === niche);
    }

    // Filter by query if specified (searches title and description)
    if (query) {
      const queryLower = query.toLowerCase();
      results = results.filter(
        job =>
          job.title.toLowerCase().includes(queryLower) ||
          job.description.toLowerCase().includes(queryLower)
      );
    }

    // Rotate and select next batch to simulate fresh listings
    const rotatedResults = [];
    for (let i = 0; i < limit && i < results.length; i++) {
      const index = (this.currentIndex + i) % results.length;
      rotatedResults.push(results[index]);
    }

    this.currentIndex = (this.currentIndex + limit) % results.length;

    return {
      success: true,
      data: rotatedResults,
      total: results.length,
      returned: rotatedResults.length
    };
  }

  /**
   * Get list of active jobs
   * @param {Object} options - Query options
   * @param {number} options.limit - Max jobs to return
   * @returns {Promise<Object>} Active jobs
   */
  async getActiveJobs(options = {}) {
    const { limit = 10 } = options;

    // Return first N jobs sorted by most recent
    const sorted = [...this.opportunities].sort(
      (a, b) => new Date(b.posted_at) - new Date(a.posted_at)
    );

    return {
      success: true,
      data: sorted.slice(0, limit),
      total: this.opportunities.length
    };
  }

  /**
   * Get job details
   * @param {string} jobId - Job ID
   * @returns {Promise<Object>} Job details
   */
  async getJob(jobId) {
    const job = this.opportunities.find(j => j.id === jobId);

    if (!job) {
      return {
        success: false,
        error: `Job not found: ${jobId}`
      };
    }

    // Mark as viewed
    this.viewedJobs.add(jobId);

    return {
      success: true,
      data: job
    };
  }

  /**
   * Search jobs by niche
   * @param {string} niche - Niche to filter by
   * @param {number} limit - Max results
   * @returns {Promise<Object>} Filtered jobs
   */
  async searchByNiche(niche, limit = 5) {
    return this.searchJobs({ niche, limit });
  }

  /**
   * Search jobs by keyword
   * @param {string} query - Search query
   * @param {number} limit - Max results
   * @returns {Promise<Object>} Search results
   */
  async search(query, limit = 5) {
    return this.searchJobs({ query, limit });
  }

  /**
   * Get recommended jobs based on niche
   * @param {string} niche - Niche to get recommendations for
   * @returns {Promise<Object>} Recommended jobs
   */
  async getRecommendations(niche) {
    return this.searchByNiche(niche, 3);
  }

  /**
   * Get jobs in multiple niches
   * @param {Array} niches - Array of niches
   * @param {number} limit - Max per niche
   * @returns {Promise<Object>} Jobs from all niches
   */
  async searchMultipleNiches(niches, limit = 3) {
    let allJobs = [];

    for (const niche of niches) {
      const results = await this.searchByNiche(niche, limit);
      allJobs.push(...results.data);
    }

    return {
      success: true,
      data: allJobs,
      total: allJobs.length
    };
  }

  /**
   * Get viewed job count
   * @returns {number} Count of viewed jobs
   */
  getViewedCount() {
    return this.viewedJobs.size;
  }

  /**
   * Reset viewing history
   */
  resetViewHistory() {
    this.viewedJobs.clear();
  }

  /**
   * Get all available niches
   * @returns {Array} List of unique niches
   */
  getAllNiches() {
    const niches = new Set(this.opportunities.map(j => j.niche));
    return Array.from(niches);
  }

  /**
   * Add custom opportunity (for testing)
   * @param {Object} opportunity - Opportunity to add
   */
  addOpportunity(opportunity) {
    if (!opportunity.id) {
      opportunity.id = `job_mock_${Date.now()}`;
    }
    if (!opportunity.posted_at) {
      opportunity.posted_at = new Date().toISOString();
    }
    this.opportunities.push(opportunity);
  }

  /**
   * Clear all opportunities and reload from file
   */
  reloadOpportunities() {
    this.opportunities = loadOpportunities();
    this.currentIndex = 0;
    this.viewedJobs.clear();
  }

  /**
   * Get statistics about opportunities
   * @returns {Object} Statistics
   */
  getStats() {
    const niches = {};
    const budgetRanges = {
      under_1k: 0,
      '1k_5k': 0,
      '5k_10k': 0,
      over_10k: 0
    };

    this.opportunities.forEach(job => {
      // Count by niche
      niches[job.niche] = (niches[job.niche] || 0) + 1;

      // Count by budget
      const amount = job.budget.type === 'fixed' ? job.budget.amount : job.budget.rate * job.budget.hours;
      if (amount < 1000) budgetRanges.under_1k++;
      else if (amount < 5000) budgetRanges['1k_5k']++;
      else if (amount < 10000) budgetRanges['5k_10k']++;
      else budgetRanges.over_10k++;
    });

    return {
      totalJobs: this.opportunities.length,
      byNiche: niches,
      byBudget: budgetRanges,
      viewedCount: this.viewedJobs.size
    };
  }
}

module.exports = UpworkMock;
