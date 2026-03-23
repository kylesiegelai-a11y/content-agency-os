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
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-change-in-production';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const MOCK_ADMIN_TOKEN = 'mock-jwt-token-for-development';

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
app.use(helmet());
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// JWT Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  // Allow mock token in development
  if (MOCK_MODE && token === MOCK_ADMIN_TOKEN) {
    return next();
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// ============================================================================
// AUTH ROUTES
// ============================================================================

/**
 * POST /api/auth/login
 * Login and get JWT token
 */
app.post('/api/auth/login', async (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: 'Password required' });
  }

  try {
    // Read the bcrypt hash from data/auth.json
    const authFilePath = path.join(__dirname, 'data', 'auth.json');
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
 * POST /api/auth/init-password
 * Initialize admin password (first time setup)
 */
app.post('/api/auth/init-password', (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new passwords required' });
  }

  if (currentPassword !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid current password' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  // In production, this would persist the new password to a database or secret manager
  console.log('[Auth] Password change requested (would be persisted in production)');

  res.json({ success: true, message: 'Password updated successfully' });
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
    const { state, queue, limit = 50 } = req.query;

    const stats = await appState.orchestrator.getQueueStats();
    const jobs = [];

    // Fetch jobs from specific queue or all queues
    const queuesToCheck = queue
      ? [appState.queues[queue]]
      : Object.values(appState.queues);

    for (const q of queuesToCheck) {
      if (!q) continue;

      const statesToCheck = state ? [state] : ['waiting', 'active', 'completed', 'failed'];
      const queueJobs = await q.getJobs(statesToCheck);

      jobs.push(...queueJobs.slice(0, limit));
    }

    res.json({
      success: true,
      jobs: jobs.map(j => ({
        id: j.id,
        state: j.state,
        priority: j.priority,
        progress: j.progress || 0,
        createdAt: j.timestamp || j.createdAt,
        data: j.data
      })),
      total: jobs.length,
      stats
    });
  } catch (error) {
    console.error('[API] GET /api/jobs error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/jobs
 * Create a new job
 */
app.post('/api/jobs', authenticateToken, async (req, res) => {
  try {
    const { type, priority = 0, deadline, data = {} } = req.body;

    if (!type) {
      return res.status(400).json({ error: 'Job type required' });
    }

    const result = await appState.orchestrator.acceptTestJob({
      type,
      priority,
      deadline,
      data
    });

    if (!result) {
      return res.status(500).json({ error: 'Failed to create job' });
    }

    res.status(201).json({
      success: true,
      message: 'Job created successfully'
    });
  } catch (error) {
    console.error('[API] POST /api/jobs error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/jobs/:jobId
 * Get job details
 */
app.get('/api/jobs/:jobId', authenticateToken, async (req, res) => {
  try {
    const { jobId } = req.params;

    const status = await appState.orchestrator.getJobStatus(jobId);

    if (!status.found) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({ success: true, job: status });
  } catch (error) {
    console.error('[API] GET /api/jobs/:jobId error:', error.message);
    res.status(500).json({ error: error.message });
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

    if (action === 'transition' && nextState) {
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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

    // Log to activity
    const storage = require('./utils/storage');
    let activityData = await storage.read('activity.json');
    if (!activityData) activityData = { activities: [] };
    const activities = activityData.activities || [];
    activities.unshift({
      timestamp: new Date().toISOString(),
      agent: 'system',
      action: 'Manual pipeline cycle triggered',
      status: 'success',
      details: `Pipeline run initiated manually by owner (${MOCK_MODE ? 'mock' : 'production'} mode)`,
      metadata: { trigger: 'manual', mode: MOCK_MODE ? 'mock' : 'production' }
    });
    await storage.write('activity.json', { activities }, false);

    res.json({
      success: true,
      mode: MOCK_MODE ? 'mock' : 'production',
      message: 'Pipeline cycle triggered successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[API] POST /api/pipeline/run error:', error.message);
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// STATIC FILE SERVING
// ============================================================================

const dashboardPath = path.join(__dirname, 'dashboard');
if (fs.existsSync(dashboardPath)) {
  app.use(express.static(dashboardPath));

  app.get('/', (req, res) => {
    res.sendFile(path.join(dashboardPath, 'index.html'));
  });
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

    // Initialize queues
    console.log('[Server] Initializing queues...');
    appState.queues = await initializeQueues();

    // Initialize orchestrator
    console.log('[Server] Initializing orchestrator...');
    appState.orchestrator = new Orchestrator(appState.queues, {
      maxRetries: process.env.MAX_RETRIES || 3
    });

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
