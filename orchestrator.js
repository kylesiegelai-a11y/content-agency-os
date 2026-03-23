/**
 * Content Agency OS - Master Orchestrator
 * Routes jobs through the state machine and coordinates agent execution
 */

const fs = require('fs');
const path = require('path');

// Job state machine definition
const JOB_STATES = {
  // Discovery and Qualification
  DISCOVERED: 'DISCOVERED',
  SCORED: 'SCORED',
  APPROVED: 'APPROVED',
  BRIEFED: 'BRIEFED',

  // Content Production Pipeline
  WRITING: 'WRITING',
  EDITING: 'EDITING',
  HUMANIZING: 'HUMANIZING',
  QUALITY_CHECK: 'QUALITY_CHECK',
  APPROVED_CONTENT: 'APPROVED_CONTENT',

  // Delivery
  DELIVERING: 'DELIVERING',
  DELIVERED: 'DELIVERED',
  CLOSED: 'CLOSED',

  // Prospect/Proposal Pipeline
  PROSPECT_APPROVED: 'PROSPECT_APPROVED',
  PROPOSAL_WRITING: 'PROPOSAL_WRITING',
  PROPOSAL_REVIEW: 'PROPOSAL_REVIEW',
  PITCHED: 'PITCHED',

  // Error states
  FAILED: 'FAILED',
  DEAD_LETTER: 'DEAD_LETTER'
};

// State transition map
const STATE_TRANSITIONS = {
  [JOB_STATES.DISCOVERED]: [JOB_STATES.SCORED, JOB_STATES.FAILED],
  [JOB_STATES.SCORED]: [JOB_STATES.APPROVED, JOB_STATES.FAILED],
  [JOB_STATES.APPROVED]: [JOB_STATES.BRIEFED, JOB_STATES.FAILED],
  [JOB_STATES.BRIEFED]: [JOB_STATES.WRITING, JOB_STATES.FAILED],
  [JOB_STATES.WRITING]: [JOB_STATES.EDITING, JOB_STATES.FAILED],
  [JOB_STATES.EDITING]: [JOB_STATES.HUMANIZING, JOB_STATES.FAILED],
  [JOB_STATES.HUMANIZING]: [JOB_STATES.QUALITY_CHECK, JOB_STATES.FAILED],
  [JOB_STATES.QUALITY_CHECK]: [JOB_STATES.APPROVED_CONTENT, JOB_STATES.FAILED],
  [JOB_STATES.APPROVED_CONTENT]: [JOB_STATES.DELIVERING, JOB_STATES.FAILED],
  [JOB_STATES.DELIVERING]: [JOB_STATES.DELIVERED, JOB_STATES.FAILED],
  [JOB_STATES.DELIVERED]: [JOB_STATES.CLOSED, JOB_STATES.FAILED],
  [JOB_STATES.CLOSED]: [],

  // Prospect pipeline
  [JOB_STATES.PROSPECT_APPROVED]: [JOB_STATES.PROPOSAL_WRITING, JOB_STATES.FAILED],
  [JOB_STATES.PROPOSAL_WRITING]: [JOB_STATES.PROPOSAL_REVIEW, JOB_STATES.FAILED],
  [JOB_STATES.PROPOSAL_REVIEW]: [JOB_STATES.PITCHED, JOB_STATES.FAILED],
  [JOB_STATES.PITCHED]: [JOB_STATES.CLOSED, JOB_STATES.FAILED],

  [JOB_STATES.FAILED]: [JOB_STATES.DEAD_LETTER],
  [JOB_STATES.DEAD_LETTER]: []
};

// Agent routing based on job state
const AGENT_ROUTES = {
  [JOB_STATES.DISCOVERED]: 'qualifier',
  [JOB_STATES.SCORED]: 'qualifier',
  [JOB_STATES.APPROVED]: 'briefer',
  [JOB_STATES.BRIEFED]: 'writer',
  [JOB_STATES.WRITING]: 'writer',
  [JOB_STATES.EDITING]: 'editor',
  [JOB_STATES.HUMANIZING]: 'humanizer',
  [JOB_STATES.QUALITY_CHECK]: 'qa',
  [JOB_STATES.APPROVED_CONTENT]: 'delivery',
  [JOB_STATES.DELIVERING]: 'delivery',
  [JOB_STATES.PROSPECT_APPROVED]: 'prospector',
  [JOB_STATES.PROPOSAL_WRITING]: 'prospector',
  [JOB_STATES.PROPOSAL_REVIEW]: 'prospector',
  [JOB_STATES.PITCHED]: 'prospector'
};

class Orchestrator {
  constructor(queues, config = {}) {
    this.queues = queues;
    this.config = config;
    this.agents = {};
    this.activityLog = [];
    this.maxRetries = config.maxRetries || 3;
    this.deadLetterQueueSize = config.deadLetterQueueSize || 100;
    this.deadLetterQueue = [];
  }

  /**
   * Load agent module dynamically
   */
  async loadAgent(agentName) {
    if (this.agents[agentName]) {
      return this.agents[agentName];
    }

    try {
      const agentPath = path.join(__dirname, 'agents', `${agentName}Agent.js`);
      if (!fs.existsSync(agentPath)) {
        console.warn(`[Orchestrator] Agent not found: ${agentPath}, using null agent`);
        this.agents[agentName] = null;
        return null;
      }

      const Agent = require(agentPath);
      this.agents[agentName] = new Agent();
      console.log(`[Orchestrator] Loaded agent: ${agentName}`);
      return this.agents[agentName];
    } catch (error) {
      console.error(`[Orchestrator] Failed to load agent ${agentName}: ${error.message}`);
      this.agents[agentName] = null;
      return null;
    }
  }

  /**
   * Validate state transition
   */
  canTransitionTo(fromState, toState) {
    if (!STATE_TRANSITIONS[fromState]) {
      return false;
    }
    return STATE_TRANSITIONS[fromState].includes(toState);
  }

  /**
   * Route job to appropriate agent queue
   */
  async routeJob(job) {
    const { id, state, priority, deadline } = job;

    // Get agent name for this state
    const agentName = AGENT_ROUTES[state];
    if (!agentName) {
      console.error(`[Orchestrator] No agent route found for state: ${state}`);
      return false;
    }

    // Load agent to verify it exists
    const agent = await this.loadAgent(agentName);
    if (!agent) {
      console.warn(`[Orchestrator] Agent ${agentName} not available for job ${id}`);
      // Still add to queue but will be handled gracefully
    }

    // Determine queue and get priority score
    const queue = this._selectQueue(state);
    const priorityScore = this._calculatePriority(priority, deadline);

    try {
      await queue.add(job, {
        priority: priorityScore,
        attempts: this.maxRetries,
        backoff: {
          type: 'exponential',
          delay: 2000
        }
      });

      this._logActivity('JOB_ROUTED', {
        jobId: id,
        fromState: state,
        toQueue: queue.name,
        agentName,
        priority: priorityScore
      });

      console.log(`[Orchestrator] Routed job ${id} to ${agentName} queue (${queue.name})`);
      return true;
    } catch (error) {
      console.error(`[Orchestrator] Failed to route job ${id}: ${error.message}`);
      return false;
    }
  }

  /**
   * Transition job to next state
   */
  async transitionJob(job, nextState, result = {}) {
    const { id, state } = job;

    if (!this.canTransitionTo(state, nextState)) {
      console.error(
        `[Orchestrator] Invalid transition: ${state} -> ${nextState} for job ${id}`
      );
      return false;
    }

    const previousState = state;
    job.state = nextState;
    job.lastTransition = {
      from: previousState,
      to: nextState,
      timestamp: new Date(),
      result
    };

    this._logActivity('STATE_TRANSITION', {
      jobId: id,
      from: previousState,
      to: nextState,
      result
    });

    console.log(`[Orchestrator] Job ${id} transitioned: ${previousState} -> ${nextState}`);

    // If next state is terminal, mark complete
    if (nextState === JOB_STATES.CLOSED) {
      job.completedAt = new Date();
      job.completionStatus = 'success';
    }

    // Route to next agent if not terminal
    if (nextState !== JOB_STATES.CLOSED && nextState !== JOB_STATES.DEAD_LETTER) {
      return this.routeJob(job);
    }

    return true;
  }

  /**
   * Handle job failure with retry logic
   */
  async handleJobFailure(job, error) {
    const { id, state, retryCount = 0 } = job;

    if (retryCount < this.maxRetries) {
      job.retryCount = retryCount + 1;
      job.lastError = error.message;
      job.lastErrorTime = new Date();

      this._logActivity('JOB_RETRY', {
        jobId: id,
        state,
        retryCount: job.retryCount,
        error: error.message
      });

      console.log(`[Orchestrator] Job ${id} retry ${job.retryCount}/${this.maxRetries}`);

      // Requeue with exponential backoff
      const delay = Math.pow(2, job.retryCount) * 1000;
      const queue = this._selectQueue(state);

      try {
        await queue.add(job, {
          delay,
          priority: this._calculatePriority(job.priority, job.deadline),
          attempts: 1
        });
        return true;
      } catch (queueError) {
        console.error(`[Orchestrator] Failed to requeue job ${id}: ${queueError.message}`);
      }
    }

    // Move to dead letter queue
    return this.moveToDeadLetterQueue(job, error);
  }

  /**
   * Move job to dead letter queue
   */
  async moveToDeadLetterQueue(job, error) {
    const { id, state } = job;

    job.state = JOB_STATES.DEAD_LETTER;
    job.failureReason = error.message;
    job.failureTime = new Date();
    job.originalState = state;

    this.deadLetterQueue.unshift(job);
    if (this.deadLetterQueue.length > this.deadLetterQueueSize) {
      this.deadLetterQueue.pop();
    }

    this._logActivity('JOB_DEAD_LETTER', {
      jobId: id,
      originalState: state,
      error: error.message
    });

    console.error(`[Orchestrator] Job ${id} moved to dead letter queue: ${error.message}`);

    return true;
  }

  /**
   * Select queue based on state
   */
  _selectQueue(state) {
    const agentName = AGENT_ROUTES[state];

    // Map agent names to queues
    const queueMap = {
      'qualifier': this.queues.prospecting,
      'briefer': this.queues.writing,
      'writer': this.queues.writing,
      'editor': this.queues.editing,
      'humanizer': this.queues.editing,
      'qa': this.queues.editing,
      'delivery': this.queues.communications,
      'prospector': this.queues.prospecting
    };

    return queueMap[agentName] || this.queues.prospecting;
  }

  /**
   * Calculate priority score based on deadline proximity and user priority
   */
  _calculatePriority(userPriority = 0, deadline = null) {
    let score = userPriority;

    if (deadline) {
      const now = new Date();
      const deadlineDate = new Date(deadline);
      const hoursUntilDeadline = (deadlineDate - now) / (1000 * 60 * 60);

      // Urgent: within 24 hours
      if (hoursUntilDeadline < 24) score += 100;
      // High: within 3 days
      else if (hoursUntilDeadline < 72) score += 50;
      // Normal: within 7 days
      else if (hoursUntilDeadline < 168) score += 25;
    }

    return Math.max(0, score);
  }

  /**
   * Accept test job for verification
   */
  async acceptTestJob(testJob) {
    const {
      id = `test-${Date.now()}`,
      type = 'content',
      priority = 0,
      deadline = null,
      data = {}
    } = testJob;

    const job = {
      id,
      type,
      state: JOB_STATES.DISCOVERED,
      priority,
      deadline,
      data,
      createdAt: new Date(),
      retryCount: 0
    };

    this._logActivity('TEST_JOB_ACCEPTED', {
      jobId: id,
      type,
      priority
    });

    console.log(`[Orchestrator] Test job accepted: ${id}`);

    // Route to first agent
    return this.routeJob(job);
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId) {
    // Check all queues for the job
    for (const [queueName, queue] of Object.entries(this.queues)) {
      const job = await queue.getJob(jobId);
      if (job) {
        const counts = await queue.getJobCounts();
        return {
          jobId,
          found: true,
          queue: queueName,
          state: job.state,
          progress: job.progress || 0,
          counts
        };
      }
    }

    // Check dead letter queue
    const dlJob = this.deadLetterQueue.find(j => j.id === jobId);
    if (dlJob) {
      return {
        jobId,
        found: true,
        queue: 'dead-letter',
        state: JOB_STATES.DEAD_LETTER,
        failureReason: dlJob.failureReason
      };
    }

    return {
      jobId,
      found: false
    };
  }

  /**
   * Get queue statistics
   */
  async getQueueStats() {
    const stats = {};

    for (const [name, queue] of Object.entries(this.queues)) {
      const counts = await queue.getJobCounts();
      stats[name] = {
        name,
        ...counts,
        total: Object.values(counts).reduce((a, b) => a + b, 0)
      };
    }

    return {
      queues: stats,
      deadLetterQueueSize: this.deadLetterQueue.length,
      timestamp: new Date()
    };
  }

  /**
   * Get dead letter queue items
   */
  getDeadLetterQueue(limit = 50) {
    return this.deadLetterQueue.slice(0, limit);
  }

  /**
   * Retry dead letter job
   */
  async retryDeadLetterJob(jobId) {
    const index = this.deadLetterQueue.findIndex(j => j.id === jobId);
    if (index === -1) {
      return false;
    }

    const job = this.deadLetterQueue.splice(index, 1)[0];
    job.state = job.originalState || JOB_STATES.DISCOVERED;
    job.failureReason = null;
    job.failureTime = null;
    job.retryCount = 0;

    this._logActivity('DEAD_LETTER_RETRY', {
      jobId,
      restoredState: job.state
    });

    console.log(`[Orchestrator] Retrying dead letter job ${jobId}`);

    return this.routeJob(job);
  }

  /**
   * Log activity for audit trail
   */
  _logActivity(action, details = {}) {
    const entry = {
      timestamp: new Date(),
      action,
      ...details
    };

    this.activityLog.push(entry);

    // Keep last 1000 entries in memory
    if (this.activityLog.length > 1000) {
      this.activityLog.shift();
    }
  }

  /**
   * Get activity log
   */
  getActivityLog(limit = 100) {
    return this.activityLog.slice(-limit).reverse();
  }

  /**
   * Clear activity log
   */
  clearActivityLog() {
    this.activityLog = [];
  }
}

// Export states and orchestrator
module.exports = {
  Orchestrator,
  JOB_STATES,
  STATE_TRANSITIONS,
  AGENT_ROUTES
};
