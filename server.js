/**
 * Content Agency OS - Express Server
 * Main application server with API routes and dashboard
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

const bcrypt = require('bcryptjs');
const { initializeQueues, closeQueues, MOCK_MODE } = require('./utils/queueConfig');
const { Orchestrator, JOB_STATES } = require('./orchestrator');
const { Scheduler } = require('./scheduler');

// Configuration
const PORT = process.env.PORT || 3001;

// --- MOCK-ONLY SECURITY RELAXATIONS ---
// Authentication is handled by utils/auth.js:
//   MOCK_MODE  → mock-dev-secret + mock admin token bypass
//   PRODUCTION → JWT_SECRET required, no mock bypass, API key support
const { AuthManager, authMiddleware: hardenedAuthMiddleware } = require('./utils/auth');
const crypto = require('crypto');
const JWT_SECRET = process.env.JWT_SECRET || (MOCK_MODE ? crypto.randomBytes(32).toString('hex') : null);

if (!MOCK_MODE && !JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required in production mode');
}

// Application state
const appState = {
  queues: null,
  orchestrator: null,
  scheduler: null,
  config: {
    killSwitch: false,
    agentPauseStates: {},
    mockMode: MOCK_MODE
  }
};

// Create Express app
const app = express();

// Middleware setup
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https:", "data:"],
    }
  }
}));
app.use(morgan('combined'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || (MOCK_MODE ? true : false),
  credentials: true
}));

// Use the hardened auth middleware from utils/auth.js
// Supports: JWT tokens, API keys (cao_*), mock token (dev only)
const authenticateToken = hardenedAuthMiddleware;

// ============================================================================
// RATE LIMITING (in-memory, per IP)
// ============================================================================

const loginAttempts = new Map();
const LOGIN_RATE_LIMIT = { maxAttempts: 5, windowMs: 15 * 60 * 1000 }; // 5 attempts per 15 min

function loginRateLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const record = loginAttempts.get(ip);

  if (record) {
    // Clean expired entries
    if (now - record.firstAttempt > LOGIN_RATE_LIMIT.windowMs) {
      loginAttempts.delete(ip);
    } else if (record.count >= LOGIN_RATE_LIMIT.maxAttempts) {
      const retryAfter = Math.ceil((record.firstAttempt + LOGIN_RATE_LIMIT.windowMs - now) / 1000);
      return res.status(429).json({
        error: 'Too many login attempts. Try again later.',
        retryAfterSeconds: retryAfter
      });
    }
  }

  // Track this attempt
  const existing = loginAttempts.get(ip);
  if (existing && (now - existing.firstAttempt <= LOGIN_RATE_LIMIT.windowMs)) {
    existing.count++;
  } else {
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
  }

  // Periodic cleanup of stale entries (every 100 requests)
  if (loginAttempts.size > 100) {
    for (const [key, val] of loginAttempts) {
      if (now - val.firstAttempt > LOGIN_RATE_LIMIT.windowMs) loginAttempts.delete(key);
    }
  }

  next();
}

// ============================================================================
// AUTH ROUTES
// ============================================================================

/**
 * POST /api/auth/login
 * Login and get JWT token (rate limited: 5 attempts per 15 min per IP)
 */
app.post('/api/auth/login', loginRateLimiter, async (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: 'Password required' });
  }

  try {
    // Read the bcrypt hash from data/auth.json
    const authFilePath = path.join(__dirname, 'data', 'auth.json');

    // In mock mode, auto-bootstrap a mock admin credential if auth data is absent
    if (!fs.existsSync(authFilePath) && MOCK_MODE) {
      const dataDir = path.dirname(authFilePath);
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      const mockHash = await bcrypt.hash('admin123', 12);
      fs.writeFileSync(authFilePath, JSON.stringify({ masterPassword: mockHash }, null, 2));
      console.log('[Auth] Mock mode: auto-created auth.json with default password (admin123)');
    }

    if (!fs.existsSync(authFilePath)) {
      return res.status(500).json({ error: 'Password not initialized. Run: node scripts/initPassword.js' });
    }

    const authData = JSON.parse(fs.readFileSync(authFilePath, 'utf8'));
    const isMatch = await bcrypt.compare(password, authData.masterPassword);

    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    const token = jwt.sign(
      { role: 'admin', timestamp: Date.now() },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token,
      expiresIn: 86400
    });
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    return res.status(500).json({ error: 'Authentication error' });
  }
});

/**
 * POST /api/auth/change-password
 * Change admin password — verifies against stored bcrypt hash, not env var
 */
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new passwords required' });
  }

  // Enforce strong password policy
  const strength = AuthManager.validatePasswordStrength(newPassword);
  if (!strength.isValid) {
    return res.status(400).json({ error: 'Weak password', details: strength.errors });
  }

  try {
    const authFilePath = path.join(__dirname, 'data', 'auth.json');
    if (!fs.existsSync(authFilePath)) {
      return res.status(500).json({ error: 'Auth store not initialized. Run: node scripts/initPassword.js' });
    }

    const authData = JSON.parse(fs.readFileSync(authFilePath, 'utf8'));
    const isMatch = await bcrypt.compare(currentPassword, authData.masterPassword);

    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid current password' });
    }

    // Hash and persist the new password
    const salt = await bcrypt.genSalt(12);
    const newHash = await bcrypt.hash(newPassword, salt);
    authData.masterPassword = newHash;
    authData.updatedAt = new Date().toISOString();
    fs.writeFileSync(authFilePath, JSON.stringify(authData, null, 2));

    console.log('[Auth] Password changed successfully');
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    console.error('[Auth] Password change error:', error.message);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

/**
 * POST /api/auth/api-keys
 * Generate a new API key for programmatic access
 */
app.post('/api/auth/api-keys', authenticateToken, async (req, res) => {
  try {
    const { label } = req.body;
    const keyRecord = await AuthManager.generateApiKey(label || 'default');
    await AuthManager.saveApiKey(keyRecord);

    // Return the full key ONCE — it cannot be retrieved again
    res.status(201).json({
      success: true,
      message: 'API key created. Save this key — it will not be shown again.',
      apiKey: keyRecord.key,
      prefix: keyRecord.keyPrefix,
      label: keyRecord.label
    });
  } catch (error) {
    console.error('[Auth] API key creation error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/auth/api-keys
 * List all API keys (prefixes only, not the actual keys)
 */
app.get('/api/auth/api-keys', authenticateToken, async (req, res) => {
  try {
    const keys = await AuthManager.getStoredApiKeys();
    res.json({
      keys: keys.map(k => ({
        prefix: k.keyPrefix,
        label: k.label,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt
      }))
    });
  } catch (error) {
    console.error('[Auth] API key list error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/auth/api-keys
 * Revoke an API key by prefix
 */
app.delete('/api/auth/api-keys', authenticateToken, async (req, res) => {
  try {
    const { prefix } = req.body;
    if (!prefix) return res.status(400).json({ error: 'Key prefix required' });
    const result = await AuthManager.revokeApiKey(prefix);
    res.json(result);
  } catch (error) {
    console.error('[Auth] API key revocation error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// GOOGLE OAUTH ROUTES (first-time setup for Gmail + Drive)
// ============================================================================

/**
 * GET /api/auth/google
 * Redirect to Google OAuth consent screen
 */
app.get('/api/auth/google', (req, res) => {
  const { isMockMode } = require('./utils/serviceFactory');
  if (isMockMode()) {
    return res.json({ message: 'Google OAuth not needed in mock mode' });
  }

  try {
    const gmailService = require('./utils/serviceFactory').getService('gmail');
    if (!gmailService.getAuthUrl) {
      return res.status(400).json({ error: 'Gmail service does not support OAuth setup' });
    }
    const authUrl = gmailService.getAuthUrl();
    res.redirect(authUrl);
  } catch (error) {
    console.error('[API] OAuth setup failed:', error.message);
    res.status(500).json({ error: 'OAuth setup failed' });
  }
});

/**
 * GET /api/auth/google/callback
 * Handle OAuth2 callback and store refresh token
 */
app.get('/api/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).json({ error: 'No authorization code provided' });
  }

  try {
    const gmailService = require('./utils/serviceFactory').getService('gmail');
    const tokens = await gmailService.handleAuthCallback(code);

    // Log token availability for the admin but do NOT return it in the HTTP response
    // to avoid leaking credentials via browser history, proxies, or logs
    if (tokens.refresh_token) {
      console.log('[OAuth] Refresh token obtained. Add it to your .env as GOOGLE_REFRESH_TOKEN.');
      console.log('[OAuth] GOOGLE_REFRESH_TOKEN=' + tokens.refresh_token);
    }

    res.json({
      message: 'Google OAuth setup complete!',
      hasRefreshToken: !!tokens.refresh_token,
      note: 'Check the server console/logs for the refresh token. Add it to your .env file.'
    });
  } catch (error) {
    console.error('[API] OAuth callback failed:', error.message);
    res.status(500).json({ error: 'OAuth callback failed' });
  }
});

// ============================================================================
// JOBS API ROUTES
// ============================================================================

/**
 * GET /api/jobs
 * List jobs with optional filtering
 */
app.get('/api/jobs', authenticateToken, async (req, res) => {
  try {
    const { state, status, sort = 'recent' } = req.query;

    // Validate and clamp query params
    const ALLOWED_SORTS = ['recent', 'oldest'];
    const safeSort = ALLOWED_SORTS.includes(sort) ? sort : 'recent';
    const parsedLimit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);

    // Use jobs.json as the canonical job store (written by orchestrator._persistJob)
    const { readData } = require('./utils/storage');
    let jobsData = await readData('jobs.json');
    if (!jobsData) jobsData = { jobs: [] };
    let jobs = jobsData.jobs || [];

    // Filter by workflow state if requested (e.g. ?state=WRITING)
    if (state) {
      jobs = jobs.filter(j => j.state === state);
    }

    // Filter by status category: active, completed, failed
    const terminalStates = ['DELIVERED', 'CLOSED'];
    const failedStates = ['FAILED', 'DEAD_LETTER'];
    if (status === 'active') {
      jobs = jobs.filter(j => !terminalStates.includes(j.state) && !failedStates.includes(j.state));
    } else if (status === 'completed') {
      jobs = jobs.filter(j => terminalStates.includes(j.state));
    } else if (status === 'failed') {
      jobs = jobs.filter(j => failedStates.includes(j.state));
    }

    // Sort: 'recent' (default) puts newest first; 'oldest' reverses
    jobs.sort((a, b) => {
      const timeA = new Date(a.lastTransition?.timestamp || a.createdAt || 0).getTime();
      const timeB = new Date(b.lastTransition?.timestamp || b.createdAt || 0).getTime();
      return safeSort === 'oldest' ? timeA - timeB : timeB - timeA;
    });

    // Apply validated limit
    const totalBeforeLimit = jobs.length;
    jobs = jobs.slice(0, parsedLimit);

    // Enrich with queue stats
    const stats = await appState.orchestrator.getQueueStats();

    res.json({
      success: true,
      jobs: jobs.map(j => ({
        id: j.id,
        workflowState: j.state || 'unknown',
        title: j.title || j.topic || '',
        priority: j.priority || 0,
        createdAt: j.createdAt,
        updatedAt: j.lastTransition?.timestamp || j.createdAt || null,
        completedAt: j.completedAt || null,
        completionStatus: j.completionStatus || null,
        retryCount: j.retryCount || 0,
        lastError: j.lastError || null,
        lastTransition: j.lastTransition ? {
          from: j.lastTransition.from,
          to: j.lastTransition.to,
          at: j.lastTransition.timestamp
        } : null
      })),
      total: totalBeforeLimit,
      returned: jobs.length,
      stats
    });
  } catch (error) {
    console.error('[API] GET /api/jobs error:', error.message);
    res.status(500).json({ error: 'Failed to retrieve jobs' });
  }
});

/**
 * POST /api/jobs
 * Create a new job
 */
app.post('/api/jobs', authenticateToken, async (req, res) => {
  try {
    const { type, priority = 0, deadline, data = {}, deliveryFormats, client } = req.body;

    // Input validation
    const ALLOWED_JOB_TYPES = ['content', 'outreach', 'proposal', 'research', 'strategy'];
    const ALLOWED_DELIVERY_FORMATS = ['markdown', 'pdf', 'html', 'google_docs'];

    if (!type || typeof type !== 'string') {
      return res.status(400).json({ error: 'Job type required' });
    }
    if (!ALLOWED_JOB_TYPES.includes(type)) {
      return res.status(400).json({ error: `Invalid job type. Allowed: ${ALLOWED_JOB_TYPES.join(', ')}` });
    }
    if (typeof data !== 'object' || Array.isArray(data)) {
      return res.status(400).json({ error: 'Job data must be a plain object' });
    }
    if (JSON.stringify(data).length > 50000) {
      return res.status(400).json({ error: 'Job data too large (max 50KB)' });
    }
    if (deliveryFormats !== undefined) {
      if (!Array.isArray(deliveryFormats) || !deliveryFormats.every(f => ALLOWED_DELIVERY_FORMATS.includes(f))) {
        return res.status(400).json({ error: `Invalid delivery format. Allowed: ${ALLOWED_DELIVERY_FORMATS.join(', ')}` });
      }
    }
    if (priority !== undefined && (typeof priority !== 'number' || priority < 0 || priority > 10)) {
      return res.status(400).json({ error: 'Priority must be a number between 0 and 10' });
    }

    const result = await appState.orchestrator.acceptTestJob({
      type,
      priority,
      deadline,
      data,
      ...(deliveryFormats && { deliveryFormats }),
      ...(client && { client })
    });

    if (!result) {
      return res.status(500).json({ error: 'Failed to create job' });
    }

    res.status(201).json({
      success: true,
      message: 'Job created successfully',
      job: {
        id: result.id,
        workflowState: result.state || 'DISCOVERED',
        createdAt: result.createdAt || null
      }
    });
  } catch (error) {
    console.error('[API] POST /api/jobs error:', error.message);
    res.status(500).json({ error: 'Failed to create job' });
  }
});

/**
 * GET /api/jobs/:jobId
 * Get job details
 */
app.get('/api/jobs/:jobId', authenticateToken, async (req, res) => {
  try {
    const { jobId } = req.params;

    // Look up in canonical jobs.json first
    const { readData } = require('./utils/storage');
    let jobsData = await readData('jobs.json');
    const jobs = (jobsData && jobsData.jobs) || [];
    const job = jobs.find(j => j.id === jobId);

    if (job) {
      return res.json({
        success: true,
        job: {
          id: job.id,
          workflowState: job.state || 'unknown',
          title: job.title || job.topic || '',
          priority: job.priority || 0,
          createdAt: job.createdAt || null,
          updatedAt: job.lastTransition?.timestamp || job.createdAt || null,
          completedAt: job.completedAt || null,
          completionStatus: job.completionStatus || null,
          retryCount: job.retryCount || 0,
          lastError: job.lastError || null,
          lastTransition: job.lastTransition ? {
            from: job.lastTransition.from,
            to: job.lastTransition.to,
            at: job.lastTransition.timestamp
          } : null,
          agentResults: job.agentResults || {}
        }
      });
    }

    // Fallback: check queue state
    const status = await appState.orchestrator.getJobStatus(jobId);
    if (!status.found) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({ success: true, job: status });
  } catch (error) {
    console.error('[API] GET /api/jobs/:jobId error:', error.message);
    res.status(500).json({ error: 'Failed to retrieve job' });
  }
});

/**
 * PATCH /api/jobs/:jobId
 * Update job (transition state, etc.)
 */
app.patch('/api/jobs/:jobId', authenticateToken, async (req, res) => {
  try {
    const { jobId } = req.params;
    const { action, nextState, result } = req.body;

    // Validate nextState against known states
    const VALID_STATES = Object.values(JOB_STATES || {});
    if (action === 'transition' && nextState) {
      if (typeof nextState !== 'string' || (VALID_STATES.length > 0 && !VALID_STATES.includes(nextState))) {
        return res.status(400).json({ error: 'Invalid target state' });
      }
      // Get job from queues
      let job = null;
      for (const queue of Object.values(appState.queues)) {
        job = await queue.getJob(jobId);
        if (job) break;
      }

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      const transitioned = await appState.orchestrator.transitionJob(
        job,
        nextState,
        result
      );

      if (!transitioned) {
        return res.status(400).json({ error: 'Invalid state transition' });
      }

      res.json({ success: true, message: 'Job transitioned successfully' });
    } else {
      res.status(400).json({ error: 'Unknown action' });
    }
  } catch (error) {
    console.error('[API] PATCH /api/jobs/:jobId error:', error.message);
    res.status(500).json({ error: 'Failed to update job' });
  }
});

/**
 * DELETE /api/jobs/:jobId
 * Cancel/remove job
 */
app.delete('/api/jobs/:jobId', authenticateToken, async (req, res) => {
  try {
    const { jobId } = req.params;

    let removed = false;
    for (const queue of Object.values(appState.queues)) {
      removed = await queue.remove(jobId);
      if (removed) break;
    }

    if (!removed) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({ success: true, message: 'Job removed successfully' });
  } catch (error) {
    console.error('[API] DELETE /api/jobs/:jobId error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// APPROVALS API ROUTES
// ============================================================================

/**
 * GET /api/approvals
 * List jobs pending approval
 */
app.get('/api/approvals', authenticateToken, async (req, res) => {
  try {
    const approvableStates = [JOB_STATES.SCORED, JOB_STATES.APPROVED_CONTENT];
    const approvals = [];

    for (const queue of Object.values(appState.queues)) {
      const jobs = await queue.getJobs(approvableStates);
      approvals.push(...jobs);
    }

    res.json({
      success: true,
      approvals: approvals.map(j => ({
        id: j.id,
        currentState: j.state,
        priority: j.priority,
        data: j.data,
        createdAt: j.timestamp || j.createdAt
      })),
      total: approvals.length
    });
  } catch (error) {
    console.error('[API] GET /api/approvals error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/approvals/:jobId/approve
 * Approve a job
 */
app.post('/api/approvals/:jobId/approve', authenticateToken, async (req, res) => {
  try {
    const { jobId } = req.params;
    const { notes } = req.body;

    let job = null;
    for (const queue of Object.values(appState.queues)) {
      job = await queue.getJob(jobId);
      if (job) break;
    }

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const nextStateMap = {
      [JOB_STATES.SCORED]: JOB_STATES.APPROVED,
      [JOB_STATES.APPROVED_CONTENT]: JOB_STATES.DELIVERING
    };

    const nextState = nextStateMap[job.state];
    if (!nextState) {
      return res.status(400).json({ error: 'Job cannot be approved from current state' });
    }

    await appState.orchestrator.transitionJob(job, nextState, {
      approvedBy: req.user.role,
      approvalNotes: notes,
      approvalTime: new Date()
    });

    res.json({ success: true, message: 'Job approved' });
  } catch (error) {
    console.error('[API] POST /api/approvals/:jobId/approve error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/approvals/:jobId/reject
 * Reject a job
 */
app.post('/api/approvals/:jobId/reject', authenticateToken, async (req, res) => {
  try {
    const { jobId } = req.params;
    const { reason } = req.body;

    let job = null;
    for (const queue of Object.values(appState.queues)) {
      job = await queue.getJob(jobId);
      if (job) break;
    }

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Move to dead letter with rejection reason
    await appState.orchestrator.moveToDeadLetterQueue(
      job,
      new Error(`Rejected: ${reason || 'No reason provided'}`)
    );

    res.json({ success: true, message: 'Job rejected' });
  } catch (error) {
    console.error('[API] POST /api/approvals/:jobId/reject error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// METRICS API ROUTES
// ============================================================================

/**
 * GET /api/metrics
 * Get system metrics
 */
app.get('/api/metrics', authenticateToken, async (req, res) => {
  try {
    const stats = await appState.orchestrator.getQueueStats();
    const activityLog = appState.orchestrator.getActivityLog(100);

    const metrics = {
      timestamp: new Date(),
      queues: stats,
      recentActivity: activityLog,
      uptime: process.uptime()
    };

    res.json({ success: true, metrics });
  } catch (error) {
    console.error('[API] GET /api/metrics error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// ACTIVITY LOG ROUTES
// ============================================================================

/**
 * GET /api/activity
 * Get activity log
 */
app.get('/api/activity', authenticateToken, (req, res) => {
  try {
    const { limit = 100 } = req.query;

    const activityLog = appState.orchestrator.getActivityLog(parseInt(limit));

    res.json({
      success: true,
      activity: activityLog,
      total: activityLog.length
    });
  } catch (error) {
    console.error('[API] GET /api/activity error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// PORTFOLIO/CLIENTS ROUTES
// ============================================================================

/**
 * GET /api/portfolio
 * Get portfolio/content library
 */
app.get('/api/portfolio', authenticateToken, async (req, res) => {
  try {
    const completedJobs = [];

    for (const queue of Object.values(appState.queues)) {
      const jobs = await queue.getJobs([JOB_STATES.DELIVERED, JOB_STATES.CLOSED]);
      completedJobs.push(...jobs);
    }

    res.json({
      success: true,
      portfolio: completedJobs.map(j => ({
        id: j.id,
        type: j.type,
        completedAt: j.completedAt,
        data: j.data
      })),
      total: completedJobs.length
    });
  } catch (error) {
    console.error('[API] GET /api/portfolio error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/clients
 * List clients
 */
app.get('/api/clients', authenticateToken, async (req, res) => {
  try {
    // In production, this would query a database
    const clients = [];

    res.json({
      success: true,
      clients,
      total: clients.length
    });
  } catch (error) {
    console.error('[API] GET /api/clients error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// SETTINGS ROUTES
// ============================================================================

/**
 * GET /api/settings
 * Get system configuration
 */
app.get('/api/settings', authenticateToken, (req, res) => {
  try {
    res.json({
      success: true,
      settings: {
        killSwitch: appState.config.killSwitch,
        agentPauseStates: appState.config.agentPauseStates,
        mockMode: appState.config.mockMode,
        schedulerTasks: appState.scheduler ? appState.scheduler.getTasks() : []
      }
    });
  } catch (error) {
    console.error('[API] GET /api/settings error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/settings
 * Update system configuration
 */
app.patch('/api/settings', authenticateToken, (req, res) => {
  try {
    const { killSwitch, agentPauseStates } = req.body;

    if (typeof killSwitch !== 'undefined') {
      appState.config.killSwitch = killSwitch;
      console.log(`[Server] Kill switch ${killSwitch ? 'ENABLED' : 'DISABLED'}`);
    }

    if (agentPauseStates) {
      appState.config.agentPauseStates = { ...appState.config.agentPauseStates, ...agentPauseStates };
      console.log('[Server] Agent pause states updated:', appState.config.agentPauseStates);
    }

    // Update scheduler config
    if (appState.scheduler) {
      appState.scheduler.config.killSwitch = appState.config.killSwitch;
      appState.scheduler.config.agentPauseStates = appState.config.agentPauseStates;
    }

    res.json({
      success: true,
      message: 'Settings updated',
      settings: appState.config
    });
  } catch (error) {
    console.error('[API] PATCH /api/settings error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/settings/kill-switch
 * Toggle kill switch
 */
app.post('/api/settings/kill-switch', authenticateToken, (req, res) => {
  try {
    const { enabled } = req.body;

    appState.config.killSwitch = enabled;
    console.log(`[Server] Kill switch set to: ${enabled}`);

    if (appState.scheduler) {
      appState.scheduler.config.killSwitch = enabled;
    }

    res.json({
      success: true,
      killSwitch: appState.config.killSwitch
    });
  } catch (error) {
    console.error('[API] POST /api/settings/kill-switch error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/settings/agents/:agentId
 * Toggle individual agent
 */
app.patch('/api/settings/agents/:agentId', authenticateToken, (req, res) => {
  try {
    const { agentId } = req.params;
    const { paused } = req.body;

    appState.config.agentPauseStates[agentId] = paused;
    console.log(`[Server] Agent ${agentId} pause state set to: ${paused}`);

    if (appState.scheduler) {
      appState.scheduler.config.agentPauseStates = appState.config.agentPauseStates;
    }

    res.json({
      success: true,
      agent: agentId,
      paused
    });
  } catch (error) {
    console.error('[API] PATCH /api/settings/agents/:agentId error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// SYSTEM STATUS ROUTES
// ============================================================================

/**
 * GET /api/system/status
 * Get system health and status
 */
app.get('/api/system/status', authenticateToken, async (req, res) => {
  try {
    const stats = await appState.orchestrator.getQueueStats();
    const dlQueue = appState.orchestrator.getDeadLetterQueue(10);

    res.json({
      success: true,
      status: {
        uptime: process.uptime(),
        mode: MOCK_MODE ? 'MOCK' : 'PRODUCTION',
        timestamp: new Date(),
        queues: stats,
        deadLetterQueue: {
          size: dlQueue.length,
          items: dlQueue
        },
        config: {
          killSwitch: appState.config.killSwitch,
          agentPauseStates: appState.config.agentPauseStates
        }
      }
    });
  } catch (error) {
    console.error('[API] GET /api/system/status error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// SCHEDULER MANAGEMENT ROUTES
// ============================================================================

/**
 * GET /api/scheduler/tasks
 * List all scheduler tasks
 */
app.get('/api/scheduler/tasks', authenticateToken, (req, res) => {
  try {
    if (!appState.scheduler) {
      return res.status(503).json({ error: 'Scheduler not initialized' });
    }

    const tasks = appState.scheduler.getTasks();

    res.json({
      success: true,
      tasks,
      total: tasks.length
    });
  } catch (error) {
    console.error('[API] GET /api/scheduler/tasks error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/scheduler/tasks/:taskId/pause
 * Pause a scheduler task
 */
app.post('/api/scheduler/tasks/:taskId/pause', authenticateToken, (req, res) => {
  try {
    if (!appState.scheduler) {
      return res.status(503).json({ error: 'Scheduler not initialized' });
    }

    const { taskId } = req.params;
    const paused = appState.scheduler.pauseTask(taskId);

    if (!paused) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json({ success: true, message: `Task ${taskId} paused` });
  } catch (error) {
    console.error('[API] POST /api/scheduler/tasks/:taskId/pause error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/scheduler/tasks/:taskId/resume
 * Resume a scheduler task
 */
app.post('/api/scheduler/tasks/:taskId/resume', authenticateToken, (req, res) => {
  try {
    if (!appState.scheduler) {
      return res.status(503).json({ error: 'Scheduler not initialized' });
    }

    const { taskId } = req.params;
    const resumed = appState.scheduler.resumeTask(taskId);

    if (!resumed) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json({ success: true, message: `Task ${taskId} resumed` });
  } catch (error) {
    console.error('[API] POST /api/scheduler/tasks/:taskId/resume error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// PIPELINE ROUTES
// ============================================================================

/**
 * POST /api/pipeline/run
 * Manually trigger a full pipeline cycle
 * In production mode, requires explicit confirmation
 */
app.post('/api/pipeline/run', authenticateToken, async (req, res) => {
  try {
    const { confirmed } = req.body;

    // In production mode, require explicit confirmation
    if (!MOCK_MODE && !confirmed) {
      return res.status(400).json({
        error: 'Production pipeline run requires confirmation',
        requiresConfirmation: true,
        message: 'This will trigger real API calls and incur costs. Send { "confirmed": true } to proceed.'
      });
    }

    if (appState.config.killSwitch) {
      return res.status(403).json({ error: 'Kill switch is active. Disable it before running the pipeline.' });
    }

    if (!appState.scheduler) {
      return res.status(503).json({ error: 'Scheduler not initialized' });
    }

    console.log(`[API] Manual pipeline run triggered (mode: ${MOCK_MODE ? 'MOCK' : 'PRODUCTION'})`);

    // Run the pipeline cycle
    await appState.scheduler._runPipelineCycle();

    // Log to activity using append (avoids read+write contention)
    const { storage } = require('./utils/storage');
    await storage.append('activity.json', {
      timestamp: new Date().toISOString(),
      agent: 'system',
      action: 'Manual pipeline cycle triggered',
      status: 'success',
      details: `Pipeline run initiated manually by owner (${MOCK_MODE ? 'mock' : 'production'} mode)`,
      metadata: { trigger: 'manual', mode: MOCK_MODE ? 'mock' : 'production' }
    });

    res.json({
      success: true,
      mode: MOCK_MODE ? 'mock' : 'production',
      message: 'Pipeline cycle triggered successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[API] POST /api/pipeline/run error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/pipeline/status
 * Get current pipeline status
 */
app.get('/api/pipeline/status', authenticateToken, async (req, res) => {
  try {
    const stats = appState.orchestrator ? await appState.orchestrator.getQueueStats() : {};

    res.json({
      success: true,
      mode: MOCK_MODE ? 'mock' : 'production',
      killSwitch: appState.config.killSwitch,
      queues: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[API] GET /api/pipeline/status error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// DEAD LETTER QUEUE ROUTES
// ============================================================================

/**
 * GET /api/dead-letter-queue
 * Get dead letter queue items
 */
app.get('/api/dead-letter-queue', authenticateToken, (req, res) => {
  try {
    const { limit = 50 } = req.query;

    const dlQueue = appState.orchestrator.getDeadLetterQueue(parseInt(limit));

    res.json({
      success: true,
      items: dlQueue,
      total: dlQueue.length
    });
  } catch (error) {
    console.error('[API] GET /api/dead-letter-queue error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/dead-letter-queue/:jobId/retry
 * Retry a dead letter job
 */
app.post('/api/dead-letter-queue/:jobId/retry', authenticateToken, async (req, res) => {
  try {
    const { jobId } = req.params;

    const retried = await appState.orchestrator.retryDeadLetterJob(jobId);

    if (!retried) {
      return res.status(404).json({ error: 'Job not found in dead letter queue' });
    }

    res.json({ success: true, message: `Job ${jobId} moved back to processing` });
  } catch (error) {
    console.error('[API] POST /api/dead-letter-queue/:jobId/retry error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// BILLING & INVOICES
// ============================================================================

const billing = require('./utils/billing');

/**
 * GET /api/invoices
 * List invoices with optional filters: ?status=draft|sent|paid&client=name&jobId=id
 */
app.get('/api/invoices', authenticateToken, async (req, res) => {
  try {
    const { status, client, jobId } = req.query;
    const result = await billing.listInvoices({ status, client, jobId });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[API] GET /api/invoices error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/invoices/summary
 * Billing summary with revenue, outstanding, averages. ?period=month|quarter|year|all
 */
app.get('/api/invoices/summary', authenticateToken, async (req, res) => {
  try {
    const { period = 'all' } = req.query;
    const summary = await billing.getBillingSummary(period);
    res.json({ success: true, summary });
  } catch (error) {
    console.error('[API] GET /api/invoices/summary error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/invoices/:invoiceId
 * Get a single invoice
 */
app.get('/api/invoices/:invoiceId', authenticateToken, async (req, res) => {
  try {
    const invoice = await billing.getInvoice(req.params.invoiceId);
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    res.json({ success: true, invoice });
  } catch (error) {
    console.error('[API] GET /api/invoices/:invoiceId error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/invoices
 * Manually create an invoice (for retainer billing or ad-hoc charges)
 */
app.post('/api/invoices', authenticateToken, async (req, res) => {
  try {
    const { client, lineItems, notes, dueInDays = 30 } = req.body;

    if (!client?.name || !lineItems?.length) {
      return res.status(400).json({ error: 'client.name and lineItems[] are required' });
    }

    const total = lineItems.reduce((sum, li) => sum + (li.total || li.unitPrice * (li.quantity || 1)), 0);
    const now = new Date();
    const dueDate = new Date(now);
    dueDate.setDate(dueDate.getDate() + dueInDays);

    const { v4: uuidv4 } = require('uuid');
    const invoice = {
      id: `inv_${uuidv4().slice(0, 8)}`,
      jobId: null,
      client: { name: client.name, email: client.email || null },
      lineItems: lineItems.map(li => ({
        description: li.description || 'Service',
        quantity: li.quantity || 1,
        unitPrice: li.unitPrice || 0,
        total: li.total || li.unitPrice * (li.quantity || 1)
      })),
      subtotal: total,
      tax: 0,
      total,
      currency: 'USD',
      billingModel: req.body.billingModel || 'per_piece',
      status: billing.INVOICE_STATUS.DRAFT,
      issuedAt: now.toISOString(),
      dueAt: dueDate.toISOString(),
      paidAt: null,
      stripeInvoiceId: null,
      stripePaymentIntentId: null,
      notes: notes || null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };

    // Save via billing module internals (read-modify-write)
    const { readData, writeData } = require('./utils/storage');
    let data = await readData('invoices.json');
    if (!data || !Array.isArray(data.invoices)) {
      data = { invoices: [], summary: {} };
    }
    data.invoices.push(invoice);
    await writeData('invoices.json', data);

    res.status(201).json({ success: true, invoice });
  } catch (error) {
    console.error('[API] POST /api/invoices error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/invoices/:invoiceId/send
 * Send a draft invoice (marks as sent, triggers Stripe if configured)
 */
app.post('/api/invoices/:invoiceId/send', authenticateToken, async (req, res) => {
  try {
    const result = await billing.sendInvoice(req.params.invoiceId);
    if (!result) return res.status(404).json({ error: 'Invoice not found' });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ success: true, invoice: result });
  } catch (error) {
    console.error('[API] POST /api/invoices/:invoiceId/send error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/invoices/:invoiceId/pay
 * Mark an invoice as paid
 */
app.post('/api/invoices/:invoiceId/pay', authenticateToken, async (req, res) => {
  try {
    const { notes, stripePaymentIntentId } = req.body || {};
    const result = await billing.markInvoicePaid(req.params.invoiceId, { notes, stripePaymentIntentId });
    if (!result) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ success: true, invoice: result });
  } catch (error) {
    console.error('[API] POST /api/invoices/:invoiceId/pay error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/invoices/:invoiceId/cancel
 * Cancel a draft or sent invoice
 */
app.post('/api/invoices/:invoiceId/cancel', authenticateToken, async (req, res) => {
  try {
    const { reason } = req.body || {};
    const result = await billing.cancelInvoice(req.params.invoiceId, reason);
    if (!result) return res.status(404).json({ error: 'Invoice not found' });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ success: true, invoice: result });
  } catch (error) {
    console.error('[API] POST /api/invoices/:invoiceId/cancel error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// OBSERVABILITY — Health, Alerts, Backup/Recovery
// ============================================================================

const observability = require('./utils/observability');

/**
 * GET /api/health
 * Full system health snapshot
 */
app.get('/api/health', authenticateToken, async (req, res) => {
  try {
    const health = await observability.getHealthSnapshot();
    const statusCode = health.status === 'critical' ? 503 : health.status === 'degraded' ? 200 : 200;
    res.status(statusCode).json(health);
  } catch (error) {
    console.error('[API] GET /api/health error:', error.message);
    res.status(500).json({ status: 'error', error: error.message });
  }
});

/**
 * GET /api/alerts
 * Recent alerts
 */
app.get('/api/alerts', authenticateToken, (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(observability.getAlerts(limit));
});

/**
 * POST /api/backup
 * Create a backup of all data stores
 */
app.post('/api/backup', authenticateToken, async (req, res) => {
  try {
    const result = await observability.createBackup();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[API] POST /api/backup error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/backups
 * List available backups
 */
app.get('/api/backups', authenticateToken, (req, res) => {
  try {
    const backups = observability.listBackups();
    res.json({ backups });
  } catch (error) {
    console.error('[API] GET /api/backups error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/restore
 * Restore from a backup (creates safety backup first)
 */
app.post('/api/restore', authenticateToken, async (req, res) => {
  try {
    const { backupName } = req.body;
    if (!backupName) return res.status(400).json({ error: 'backupName required' });
    const result = await observability.restoreBackup(backupName);
    res.json(result);
  } catch (error) {
    console.error('[API] POST /api/restore error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// COMPLIANCE GUARDRAILS
// ============================================================================

const compliance = require('./utils/compliance');

/**
 * GET /api/compliance/summary
 * Full compliance dashboard: rate limits, suppression, audit log
 */
app.get('/api/compliance/summary', authenticateToken, async (req, res) => {
  try {
    const summary = await compliance.getComplianceSummary();
    res.json(summary);
  } catch (error) {
    console.error('[API] GET /api/compliance/summary error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/compliance/rate-limits
 * Current rate-limit status for today
 */
app.get('/api/compliance/rate-limits', authenticateToken, async (req, res) => {
  try {
    const status = await compliance.getRateLimitStatus();
    res.json(status);
  } catch (error) {
    console.error('[API] GET /api/compliance/rate-limits error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/compliance/suppression
 * Get suppression list (emails + domains)
 */
app.get('/api/compliance/suppression', authenticateToken, async (req, res) => {
  try {
    const list = await compliance.getSuppressionList();
    res.json(list);
  } catch (error) {
    console.error('[API] GET /api/compliance/suppression error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/compliance/suppression/email
 * Add an email to the suppression list
 */
app.post('/api/compliance/suppression/email', authenticateToken, async (req, res) => {
  try {
    const { email, reason } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const result = await compliance.addToSuppressionList(email, reason || 'manual', 'user');
    res.json(result);
  } catch (error) {
    console.error('[API] POST /api/compliance/suppression/email error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/compliance/suppression/email
 * Remove an email from the suppression list
 */
app.delete('/api/compliance/suppression/email', authenticateToken, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const result = await compliance.removeFromSuppressionList(email);
    res.json(result);
  } catch (error) {
    console.error('[API] DELETE /api/compliance/suppression/email error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/compliance/suppression/domain
 * Add a domain to the suppression list
 */
app.post('/api/compliance/suppression/domain', authenticateToken, async (req, res) => {
  try {
    const { domain, reason } = req.body;
    if (!domain) return res.status(400).json({ error: 'Domain required' });
    const result = await compliance.addDomainToSuppressionList(domain, reason || 'manual', 'user');
    res.json(result);
  } catch (error) {
    console.error('[API] POST /api/compliance/suppression/domain error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/compliance/suppression/domain
 * Remove a domain from the suppression list
 */
app.delete('/api/compliance/suppression/domain', authenticateToken, async (req, res) => {
  try {
    const { domain } = req.body;
    if (!domain) return res.status(400).json({ error: 'Domain required' });
    const result = await compliance.removeDomainFromSuppressionList(domain);
    res.json(result);
  } catch (error) {
    console.error('[API] DELETE /api/compliance/suppression/domain error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/compliance/check
 * Pre-send compliance check for an email address
 */
app.post('/api/compliance/check', authenticateToken, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const result = await compliance.preSendCheck(email);
    res.json(result);
  } catch (error) {
    console.error('[API] POST /api/compliance/check error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/compliance/purge
 * GDPR/CCPA data purge — remove all PII for an email address
 */
app.post('/api/compliance/purge', authenticateToken, async (req, res) => {
  try {
    const { email, regulation } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const result = await compliance.purgePersonalData(email, 'owner', regulation || 'manual');
    res.json(result);
  } catch (error) {
    console.error('[API] POST /api/compliance/purge error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/compliance/audit-log
 * Get compliance audit trail
 */
app.get('/api/compliance/audit-log', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const log = await compliance.getAuditLog(limit);
    res.json(log);
  } catch (error) {
    console.error('[API] GET /api/compliance/audit-log error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// DELIVERY FORMAT CONFIGURATION
// ============================================================================

const { SUPPORTED_FORMATS, KAIL_BRAND } = require('./utils/deliveryFormats');

/**
 * GET /api/delivery/config
 * Get supported delivery formats and current branding
 */
app.get('/api/delivery/config', authenticateToken, async (req, res) => {
  try {
    res.json({
      supportedFormats: SUPPORTED_FORMATS,
      defaultFormats: ['markdown'],
      defaultBrand: KAIL_BRAND
    });
  } catch (error) {
    console.error('[API] GET /api/delivery/config error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/delivery/preview
 * Generate a preview delivery in requested formats (for testing)
 */
app.post('/api/delivery/preview', authenticateToken, async (req, res) => {
  try {
    const { generateDeliverables } = require('./utils/deliveryFormats');
    const { title = 'Preview Deliverable', body = 'This is a sample preview of the delivery format.', formats = ['markdown', 'html', 'pdf'], client } = req.body;

    const mockJob = {
      id: `preview_${Date.now()}`,
      jobId: `preview_${Date.now()}`,
      content: { title, body },
      deliveryFormats: formats,
      client: client || {}
    };

    const results = await generateDeliverables(mockJob, mockJob.content, { formats });

    res.json({
      success: true,
      preview: true,
      results
    });
  } catch (error) {
    console.error('[API] POST /api/delivery/preview error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// STATIC FILE SERVING
// ============================================================================

// Serve built dashboard from dashboard/dist
const dashboardDist = path.join(__dirname, 'dashboard', 'dist');
const dashboardPath = path.join(__dirname, 'dashboard');

if (fs.existsSync(dashboardDist)) {
  console.log('[Server] Serving built dashboard from dashboard/dist');
  app.use(express.static(dashboardDist));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(dashboardDist, 'index.html'));
  });
} else if (MOCK_MODE && fs.existsSync(dashboardPath)) {
  // Raw dashboard fallback — ONLY in mock/dev mode (use Vite dev server on :5173 for full frontend dev)
  console.log('[Server] MOCK MODE: Serving raw dashboard files (use Vite dev server for frontend dev)');
  app.use(express.static(dashboardPath));

  app.get('/', (req, res) => {
    res.sendFile(path.join(dashboardPath, 'index.html'));
  });
} else {
  console.warn('[Server] WARNING: dashboard/dist not found. Run "npm run build" to build the dashboard.');
}

// ============================================================================
// ERROR HANDLING MIDDLEWARE
// ============================================================================

app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err);

  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    status: err.status || 500
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ============================================================================
// SERVER STARTUP
// ============================================================================

async function startServer() {
  try {
    console.log('');
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║     Content Agency OS - Server Starting                ║');
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log('');

    // Initialize data stores (SQLite or JSON based on USE_SQLITE env var)
    const { storage, USE_SQLITE } = require('./utils/storage');
    if (USE_SQLITE) {
      console.log('[Server] Initializing SQLite database...');
      const database = require('./utils/database');
      await database.initDatabase();
      console.log('[Server] SQLite ready');
    } else {
      console.log('[Server] Initializing JSON data stores...');
    }
    const dataStores = {
      'activity.json': { activities: [] },
      'jobs.json': { jobs: [] },
      'metrics.json': { totalEarnings: 0, totalJobs: 0, activeJobs: 0, completedJobs: 0 },
      'portfolio.json': { items: [] },
      'approvals.json': { items: [] },
      'niches.json': { niches: {} },
      'ledger.json': { transactions: [], total: 0 },
      'invoices.json': { invoices: [], summary: { totalInvoiced: 0, totalPaid: 0, totalOutstanding: 0 } },
      'compliance.json': { rateLimits: {}, suppression: { emails: [], domains: [] }, sendLog: [], purgeLog: [], auditLog: [] }
    };
    for (const [fileName, defaultContent] of Object.entries(dataStores)) {
      await storage.initialize(fileName, defaultContent);
    }

    // Initialize queues
    console.log('[Server] Initializing queues...');
    appState.queues = await initializeQueues();

    // Initialize orchestrator
    console.log('[Server] Initializing orchestrator...');
    appState.orchestrator = new Orchestrator(appState.queues, {
      maxRetries: process.env.MAX_RETRIES !== undefined ? parseInt(process.env.MAX_RETRIES, 10) : 3
    });

    // Register queue processors — this wires queues to the orchestrator
    console.log('[Server] Registering queue processors...');
    for (const [name, queue] of Object.entries(appState.queues)) {
      queue.process(async (job) => {
        console.log(`[Queue:${name}] Processing job ${job.data?.id || job.id}`);
        return appState.orchestrator.processJob(job);
      });
      console.log(`[Server] Processor registered for queue: ${name}`);
    }

    // Initialize scheduler
    console.log('[Server] Initializing scheduler...');
    appState.scheduler = new Scheduler(appState.orchestrator, {
      killSwitch: appState.config.killSwitch,
      agentPauseStates: appState.config.agentPauseStates
    });
    await appState.scheduler.initialize();

    // Start server
    const server = app.listen(PORT, () => {
      console.log(`[Server] Listening on port ${PORT}`);
      console.log(`[Server] Mode: ${MOCK_MODE ? 'MOCK' : 'PRODUCTION'}`);
      console.log(`[Server] Dashboard: http://localhost:${PORT}`);
      console.log(`[Server] API: http://localhost:${PORT}/api`);
      console.log('');
    });

    // Graceful shutdown
    const shutdown = async () => {
      console.log('');
      console.log('[Server] Shutting down gracefully...');

      server.close(() => {
        console.log('[Server] HTTP server closed');
      });

      if (appState.scheduler) {
        await appState.scheduler.shutdown();
      }

      if (appState.queues) {
        await closeQueues(appState.queues);
      }

      // Close SQLite if active
      if (USE_SQLITE) {
        try { require('./utils/database').closeDatabase(); } catch {}
      }

      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (error) {
    console.error('[Server] Failed to start:', error.message);
    process.exit(1);
  }
}

// Start the server
if (require.main === module) {
  startServer();
}

module.exports = { app, appState };
