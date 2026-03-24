/**
 * Acquisition Routes
 * Express router for acquisition API endpoints
 * Handles form submissions, referrals, CSV imports, and opportunity management
 */

const express = require('express');
const logger = require('../utils/logger');

/**
 * Create acquisition router with engine, storage, and auth middleware
 * @param {AcquisitionEngine} engine - The acquisition engine instance
 * @param {Storage} storage - The storage instance
 * @param {Function} authMiddleware - Express middleware for authentication
 * @returns {express.Router} Configured Express router
 */
function createAcquisitionRouter(engine, storage, authMiddleware) {
  const router = express.Router();

  // Apply auth middleware to all routes
  router.use(authMiddleware);

  // ============================================================================
  // POST /api/acquisition/ingest/form
  // ============================================================================
  /**
   * Ingest opportunity from form/webhook submission
   * Body: { title, description, name, email, company, budget, timeline, services, message }
   */
  router.post('/ingest/form', async (req, res) => {
    try {
      const formSource = engine.registry?.getSource('form');
      if (!formSource) {
        return res.status(500).json({
          success: false,
          error: 'Form source not available'
        });
      }

      const formSubmission = {
        title: req.body.title,
        description: req.body.description,
        name: req.body.name,
        email: req.body.email,
        company: req.body.company,
        budget: req.body.budget,
        timeline: req.body.timeline,
        services: req.body.services,
        message: req.body.message
      };

      // Submit to form source
      const submitResult = formSource.submitForm(formSubmission);
      if (!submitResult.valid) {
        return res.status(400).json({
          success: false,
          error: 'Form validation failed',
          details: submitResult.errors
        });
      }

      // Ingest the single opportunity
      const opportunity = formSource.normalizeOpportunity(formSubmission);
      const ingestionResult = await engine.ingestSingleOpportunity(opportunity);

      return res.status(201).json({
        success: true,
        data: {
          id: ingestionResult.opportunity.id,
          status: ingestionResult.opportunity.status,
          persisted: ingestionResult.persisted,
          reason: ingestionResult.reason
        }
      });
    } catch (error) {
      logger.error('[AcquisitionRoutes] Form ingest error:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to ingest form submission',
        details: error.message
      });
    }
  });

  // ============================================================================
  // POST /api/acquisition/ingest/referral
  // ============================================================================
  /**
   * Ingest referral opportunity
   * Body: { referrer_name, referrer_email, client_name, client_email, company_name, title, description, budget, notes }
   */
  router.post('/ingest/referral', async (req, res) => {
    try {
      const referralSource = engine.registry?.getSource('referral');
      if (!referralSource) {
        return res.status(500).json({
          success: false,
          error: 'Referral source not available'
        });
      }

      const referralSubmission = {
        referrer_name: req.body.referrer_name,
        referrer_email: req.body.referrer_email,
        client_name: req.body.client_name,
        client_email: req.body.client_email,
        company_name: req.body.company_name,
        title: req.body.title,
        description: req.body.description,
        budget: req.body.budget,
        notes: req.body.notes
      };

      // Submit to referral source
      const submitResult = referralSource.submitReferral(referralSubmission);
      if (!submitResult.valid) {
        return res.status(400).json({
          success: false,
          error: 'Referral validation failed',
          details: submitResult.errors
        });
      }

      // Ingest the single opportunity
      const opportunity = referralSource.normalizeOpportunity(referralSubmission);
      const ingestionResult = await engine.ingestSingleOpportunity(opportunity);

      return res.status(201).json({
        success: true,
        data: {
          id: ingestionResult.opportunity.id,
          status: ingestionResult.opportunity.status,
          persisted: ingestionResult.persisted,
          reason: ingestionResult.reason
        }
      });
    } catch (error) {
      logger.error('[AcquisitionRoutes] Referral ingest error:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to ingest referral',
        details: error.message
      });
    }
  });

  // ============================================================================
  // POST /api/acquisition/import/csv
  // ============================================================================
  /**
   * Import opportunities from CSV
   * Body: { csv: "csv string content" } or { data: [...array of objects...] }
   */
  router.post('/import/csv', async (req, res) => {
    try {
      const csvSource = engine.registry?.getSource('csv_import');
      if (!csvSource) {
        return res.status(500).json({
          success: false,
          error: 'CSV import source not available'
        });
      }

      let importResult;

      // Handle CSV string input
      if (req.body.csv && typeof req.body.csv === 'string') {
        importResult = await csvSource.importFromCsv(req.body.csv);
      }
      // Handle JSON array input
      else if (req.body.data && Array.isArray(req.body.data)) {
        importResult = await csvSource.importFromJson(req.body.data);
      }
      // Handle both as fallback
      else if (req.body.csv || req.body.data) {
        return res.status(400).json({
          success: false,
          error: 'Invalid input format. Expected { csv: "..." } or { data: [...] }'
        });
      } else {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: csv or data'
        });
      }

      // Ingest all accepted opportunities
      const ingestionResults = [];
      for (const opportunity of importResult.accepted) {
        const result = await engine.ingestSingleOpportunity(opportunity);
        ingestionResults.push({
          id: result.opportunity.id,
          status: result.opportunity.status,
          persisted: result.persisted,
          reason: result.reason
        });
      }

      return res.status(201).json({
        success: true,
        data: {
          imported: ingestionResults,
          report: importResult.report
        }
      });
    } catch (error) {
      logger.error('[AcquisitionRoutes] CSV import error:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to import CSV',
        details: error.message
      });
    }
  });

  // ============================================================================
  // POST /api/acquisition/cycle
  // ============================================================================
  /**
   * Trigger a full acquisition cycle (fetch from all active sources)
   */
  router.post('/cycle', async (req, res) => {
    try {
      const report = await engine.runAcquisitionCycle(req.body || {});

      return res.json({
        success: true,
        data: report
      });
    } catch (error) {
      logger.error('[AcquisitionRoutes] Acquisition cycle error:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to run acquisition cycle',
        details: error.message
      });
    }
  });

  // ============================================================================
  // GET /api/acquisition/opportunities
  // ============================================================================
  /**
   * List opportunities with filters
   * Query: ?status=qualified&source_type=form&limit=50&offset=0&sort=received_at
   */
  router.get('/opportunities', async (req, res) => {
    try {
      if (!storage) {
        return res.status(500).json({
          success: false,
          error: 'Storage not configured'
        });
      }

      const data = await storage.read('opportunities.json');
      let opportunities = (data && data.items) || (Array.isArray(data) ? data : []);

      // Filter by status
      if (req.query.status) {
        opportunities = opportunities.filter(o => o.status === req.query.status);
      }

      // Filter by source_type
      if (req.query.source_type) {
        opportunities = opportunities.filter(o => o.source_type === req.query.source_type);
      }

      // Sort
      const sortField = req.query.sort || 'received_at';
      opportunities.sort((a, b) => {
        const aVal = a[sortField];
        const bVal = b[sortField];
        if (aVal < bVal) return 1;
        if (aVal > bVal) return -1;
        return 0;
      });

      // Pagination
      const limit = parseInt(req.query.limit || '50', 10);
      const offset = parseInt(req.query.offset || '0', 10);
      const paginated = opportunities.slice(offset, offset + limit);

      return res.json({
        success: true,
        data: {
          opportunities: paginated,
          total: opportunities.length,
          limit,
          offset
        }
      });
    } catch (error) {
      logger.error('[AcquisitionRoutes] List opportunities error:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to list opportunities',
        details: error.message
      });
    }
  });

  // ============================================================================
  // GET /api/acquisition/opportunities/:id
  // ============================================================================
  /**
   * Get single opportunity with full details including scoring
   */
  router.get('/opportunities/:id', async (req, res) => {
    try {
      if (!storage) {
        return res.status(500).json({
          success: false,
          error: 'Storage not configured'
        });
      }

      const data = await storage.read('opportunities.json');
      const opportunities = (data && data.items) || (Array.isArray(data) ? data : []);
      const opportunity = opportunities.find(o => o.id === req.params.id);

      if (!opportunity) {
        return res.status(404).json({
          success: false,
          error: 'Opportunity not found'
        });
      }

      return res.json({
        success: true,
        data: opportunity
      });
    } catch (error) {
      logger.error('[AcquisitionRoutes] Get opportunity error:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to get opportunity',
        details: error.message
      });
    }
  });

  // ============================================================================
  // POST /api/acquisition/opportunities/:id/review
  // ============================================================================
  /**
   * Review (approve/reject) a needs_review opportunity
   * Body: { action: 'approve'|'reject', notes: '...' }
   */
  router.post('/opportunities/:id/review', async (req, res) => {
    try {
      const action = req.body.action;
      const notes = req.body.notes || '';

      if (!action || !['approve', 'reject'].includes(action)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid action. Must be "approve" or "reject"'
        });
      }

      const result = await engine.reviewOpportunity(req.params.id, action, notes);

      if (result.error) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }

      return res.json({
        success: true,
        data: result.opportunity
      });
    } catch (error) {
      logger.error('[AcquisitionRoutes] Review opportunity error:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to review opportunity',
        details: error.message
      });
    }
  });

  // ============================================================================
  // GET /api/acquisition/sources
  // ============================================================================
  /**
   * Get status of all acquisition sources
   */
  router.get('/sources', (req, res) => {
    try {
      const statuses = engine.getSourceStatuses();

      return res.json({
        success: true,
        data: {
          sources: statuses,
          activeCount: statuses.filter(s => s.activeInCurrentMode).length,
          totalCount: statuses.length
        }
      });
    } catch (error) {
      logger.error('[AcquisitionRoutes] Get sources error:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to get source statuses',
        details: error.message
      });
    }
  });

  // ============================================================================
  // GET /api/acquisition/metrics
  // ============================================================================
  /**
   * Get acquisition metrics
   */
  router.get('/metrics', (req, res) => {
    try {
      const metrics = engine.getMetrics();

      return res.json({
        success: true,
        data: metrics
      });
    } catch (error) {
      logger.error('[AcquisitionRoutes] Get metrics error:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to get metrics',
        details: error.message
      });
    }
  });

  return router;
}

module.exports = createAcquisitionRouter;
