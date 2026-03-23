/**
 * Content Agency OS - Scheduler
 * Manages cron jobs and pipeline cycles
 */

const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { storage } = require('./utils/storage');

class Scheduler extends EventEmitter {
  constructor(orchestrator, config = {}) {
    super();
    this.orchestrator = orchestrator;
    this.config = config;
    this.tasks = new Map();
    this.activityLogFile = config.activityLogFile ||
      path.join(__dirname, 'data', 'activity.json');
  }

  /**
   * Initialize all scheduled tasks
   */
  async initialize() {
    console.log('[Scheduler] Initializing scheduled tasks...');

    try {
      // Main pipeline cycle - every 4 hours
      this.scheduleTask(
        'pipeline-cycle',
        '0 */4 * * *',
        () => this._runPipelineCycle(),
        'Main pipeline cycle - processes jobs through states'
      );

      // Cold outreach cycle - daily at 9am
      this.scheduleTask(
        'cold-outreach',
        '0 9 * * *',
        () => this._runColdOutreachCycle(),
        'Cold outreach cycle - identifies and qualifies new prospects'
      );

      // Re-engagement cycle - weekly Monday at 10am
      this.scheduleTask(
        're-engagement',
        '0 10 * * 1',
        () => this._runReEngagementCycle(),
        'Re-engagement cycle - targets inactive clients'
      );

      // Niche expansion check - monthly on 1st at 11am
      this.scheduleTask(
        'niche-expansion',
        '0 11 1 * *',
        () => this._runNicheExpansionCheck(),
        'Niche expansion check - evaluates new market opportunities'
      );

      // Gmail inbox monitoring - every 15 minutes
      this.scheduleTask(
        'gmail-monitoring',
        '*/15 * * * *',
        () => this._monitorGmailInbox(),
        'Gmail inbox monitoring - checks for new leads and responses'
      );

      // Accounting summary - daily at midnight
      this.scheduleTask(
        'accounting-summary',
        '0 0 * * *',
        () => this._runAccountingSummary(),
        'Accounting summary - generates daily financial reports'
      );

      console.log(`[Scheduler] Initialized ${this.tasks.size} scheduled tasks`);

      return true;
    } catch (error) {
      console.error(`[Scheduler] Initialization failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Schedule a task with cron expression
   */
  scheduleTask(taskId, cronExpression, handler, description = '') {
    try {
      // Validate cron expression
      if (!cron.validate(cronExpression)) {
        throw new Error(`Invalid cron expression: ${cronExpression}`);
      }

      const task = {
        id: taskId,
        cronExpression,
        description,
        handler,
        lastRun: null,
        nextRun: null,
        status: 'scheduled',
        runCount: 0,
        lastError: null
      };

      const cronJob = cron.schedule(cronExpression, async () => {
        await this._executeTask(task);
      }, {
        scheduled: !this._isGlobalKillSwitchEnabled(),
        runOnInit: false
      });

      task.cronJob = cronJob;
      this.tasks.set(taskId, task);

      console.log(`[Scheduler] Scheduled task: ${taskId} (${cronExpression}) - ${description}`);

      return task;
    } catch (error) {
      console.error(`[Scheduler] Failed to schedule task ${taskId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Execute a task with error handling
   */
  async _executeTask(task) {
    const { id, handler } = task;

    // Check kill switch and agent pause states
    if (!this._shouldRunTask(id)) {
      console.log(`[Scheduler] Task ${id} skipped (paused or disabled)`);
      return;
    }

    console.log(`[Scheduler] Executing task: ${id}`);
    const startTime = Date.now();

    try {
      task.status = 'running';
      await handler();

      const duration = Date.now() - startTime;
      task.lastRun = new Date();
      task.runCount++;
      task.status = 'scheduled';
      task.lastError = null;

      this._logActivity('TASK_COMPLETED', {
        taskId: id,
        duration,
        timestamp: task.lastRun
      });

      console.log(`[Scheduler] Task ${id} completed in ${duration}ms`);

      this.emit('task-completed', { taskId: id, duration });
    } catch (error) {
      const duration = Date.now() - startTime;

      task.status = 'error';
      task.lastRun = new Date();
      task.lastError = error.message;

      this._logActivity('TASK_FAILED', {
        taskId: id,
        error: error.message,
        duration,
        timestamp: task.lastRun
      });

      console.error(`[Scheduler] Task ${id} failed: ${error.message}`);

      this.emit('task-failed', { taskId: id, error: error.message });
    }
  }

  /**
   * Run main pipeline cycle
   */
  async _runPipelineCycle() {
    console.log('[Scheduler] Starting pipeline cycle...');

    const stats = await this.orchestrator.getQueueStats();
    console.log('[Scheduler] Queue statistics:', JSON.stringify(stats, null, 2));

    // Process priority jobs
    const priorityThreshold = 50;
    for (const [queueName, queue] of Object.entries(this.orchestrator.queues)) {
      const jobs = await queue.getJobs(['waiting']);
      const priorityJobs = jobs.filter(j => (j.priority || 0) >= priorityThreshold);

      if (priorityJobs.length > 0) {
        console.log(`[Scheduler] Found ${priorityJobs.length} priority jobs in ${queueName}`);
      }
    }

    this._logActivity('PIPELINE_CYCLE_RUN', {
      timestamp: new Date(),
      stats
    });
  }

  /**
   * Run cold outreach cycle
   */
  async _runColdOutreachCycle() {
    console.log('[Scheduler] Starting cold outreach cycle...');

    try {
      const prospects = await this._identifyProspects();
      console.log(`[Scheduler] Identified ${prospects.length} new prospects`);

      for (const prospect of prospects) {
        await this.orchestrator.acceptTestJob({
          type: 'prospect-outreach',
          data: prospect,
          priority: 25,
          deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
        });
      }

      this._logActivity('COLD_OUTREACH_CYCLE', {
        prospectCount: prospects.length,
        timestamp: new Date()
      });

      console.log(`[Scheduler] Cold outreach cycle created ${prospects.length} jobs`);
    } catch (error) {
      console.error(`[Scheduler] Cold outreach cycle failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Run re-engagement cycle
   */
  async _runReEngagementCycle() {
    console.log('[Scheduler] Starting re-engagement cycle...');

    try {
      const inactiveClients = await this._findInactiveClients();
      console.log(`[Scheduler] Found ${inactiveClients.length} inactive clients`);

      for (const client of inactiveClients) {
        await this.orchestrator.acceptTestJob({
          type: 'reengagement-outreach',
          data: client,
          priority: 30,
          deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) // 14 days
        });
      }

      this._logActivity('REENGAGEMENT_CYCLE', {
        clientCount: inactiveClients.length,
        timestamp: new Date()
      });

      console.log(`[Scheduler] Re-engagement cycle created ${inactiveClients.length} jobs`);
    } catch (error) {
      console.error(`[Scheduler] Re-engagement cycle failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Run niche expansion check
   */
  async _runNicheExpansionCheck() {
    console.log('[Scheduler] Starting niche expansion check...');

    try {
      const newNiches = await this._evaluateNewNiches();
      console.log(`[Scheduler] Identified ${newNiches.length} expansion opportunities`);

      for (const niche of newNiches) {
        await this.orchestrator.acceptTestJob({
          type: 'niche-research',
          data: niche,
          priority: 20
        });
      }

      this._logActivity('NICHE_EXPANSION_CHECK', {
        nicheCount: newNiches.length,
        timestamp: new Date()
      });

      console.log(`[Scheduler] Niche expansion created ${newNiches.length} research jobs`);
    } catch (error) {
      console.error(`[Scheduler] Niche expansion check failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Monitor Gmail inbox
   */
  async _monitorGmailInbox() {
    // Only log periodically to avoid spam
    const taskData = this.tasks.get('gmail-monitoring');
    if (taskData && taskData.runCount % 4 === 0) {
      console.log('[Scheduler] Monitoring Gmail inbox...');
    }

    try {
      const newMessages = await this._fetchGmailMessages();
      if (newMessages.length > 0) {
        console.log(`[Scheduler] Found ${newMessages.length} new messages`);

        for (const message of newMessages) {
          // Create jobs for processing
          await this.orchestrator.acceptTestJob({
            type: 'email-processing',
            data: message,
            priority: 40, // Higher priority for direct communications
            deadline: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
          });
        }
      }

      this._logActivity('GMAIL_MONITORING', {
        messageCount: newMessages.length,
        timestamp: new Date()
      });
    } catch (error) {
      console.error(`[Scheduler] Gmail monitoring failed: ${error.message}`);
    }
  }

  /**
   * Run accounting summary
   */
  async _runAccountingSummary() {
    console.log('[Scheduler] Starting accounting summary...');

    try {
      const summary = await this._generateAccountingSummary();

      this._logActivity('ACCOUNTING_SUMMARY', {
        summary,
        timestamp: new Date()
      });

      console.log('[Scheduler] Accounting summary completed');
    } catch (error) {
      console.error(`[Scheduler] Accounting summary failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Identify new prospects (mock implementation)
   */
  async _identifyProspects() {
    // In production, this would query a database or API
    return [
      {
        name: 'Tech Startup ABC',
        email: 'contact@techstartup.com',
        industry: 'SaaS',
        score: 75
      }
    ];
  }

  /**
   * Find inactive clients (mock implementation)
   */
  async _findInactiveClients() {
    // In production, this would query CRM or database
    return [
      {
        clientId: 'client-123',
        name: 'Client Corp',
        lastContact: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) // 90 days ago
      }
    ];
  }

  /**
   * Evaluate new niches (mock implementation)
   */
  async _evaluateNewNiches() {
    // In production, this would analyze market data
    return [
      {
        niche: 'AI-powered Education',
        marketSize: 'large',
        competition: 'medium',
        potential: 8.5
      }
    ];
  }

  /**
   * Fetch Gmail messages (mock implementation)
   */
  async _fetchGmailMessages() {
    // In production, this would connect to Gmail API
    return [];
  }

  /**
   * Generate accounting summary (mock implementation)
   */
  async _generateAccountingSummary() {
    return {
      dailyRevenue: 0,
      pendingInvoices: 0,
      completedJobs: 0,
      jobsInProgress: 0
    };
  }

  /**
   * Check if global kill switch is enabled
   */
  _isGlobalKillSwitchEnabled() {
    return this.config.killSwitch === true;
  }

  /**
   * Determine if task should run based on kill switch and agent states
   */
  _shouldRunTask(taskId) {
    // Check global kill switch
    if (this._isGlobalKillSwitchEnabled()) {
      return false;
    }

    // Check individual agent pause states from config
    const agentPauseMap = this.config.agentPauseStates || {};

    const taskAgentMap = {
      'pipeline-cycle': ['writer', 'editor', 'qa', 'delivery'],
      'cold-outreach': ['prospector', 'qualifier'],
      're-engagement': ['prospector'],
      'niche-expansion': ['prospector'],
      'gmail-monitoring': ['prospector', 'briefer'],
      'accounting-summary': ['accounting']
    };

    const agents = taskAgentMap[taskId] || [];
    return !agents.some(agent => agentPauseMap[agent] === true);
  }

  /**
   * Log activity to file
   */
  _logActivity(action, details = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      action,
      ...details
    };

    // Use the shared storage module for consistent access to activity.json
    storage.append('activity.json', entry).catch(error => {
      console.error(`[Scheduler] Failed to log activity: ${error.message}`);
    });
  }

  /**
   * Get all scheduled tasks
   */
  getTasks() {
    return Array.from(this.tasks.values()).map(task => ({
      id: task.id,
      cronExpression: task.cronExpression,
      description: task.description,
      status: task.status,
      lastRun: task.lastRun,
      runCount: task.runCount,
      lastError: task.lastError
    }));
  }

  /**
   * Get task by ID
   */
  getTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    return {
      id: task.id,
      cronExpression: task.cronExpression,
      description: task.description,
      status: task.status,
      lastRun: task.lastRun,
      runCount: task.runCount,
      lastError: task.lastError
    };
  }

  /**
   * Pause a task
   */
  pauseTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    if (task.cronJob) {
      task.cronJob.stop();
      task.status = 'paused';
      console.log(`[Scheduler] Paused task: ${taskId}`);
      return true;
    }

    return false;
  }

  /**
   * Resume a task
   */
  resumeTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    if (task.cronJob) {
      task.cronJob.start();
      task.status = 'scheduled';
      console.log(`[Scheduler] Resumed task: ${taskId}`);
      return true;
    }

    return false;
  }

  /**
   * Shutdown scheduler
   */
  async shutdown() {
    console.log('[Scheduler] Shutting down...');

    for (const [taskId, task] of this.tasks) {
      if (task.cronJob) {
        task.cronJob.stop();
        console.log(`[Scheduler] Stopped task: ${taskId}`);
      }
    }

    this.tasks.clear();
    console.log('[Scheduler] Shutdown complete');
  }
}

module.exports = { Scheduler };
