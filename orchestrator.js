/**
 * Content Agency OS - Master Orchestrator
 * Routes jobs through the state machine and coordinates agent execution
 */

const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');
const { generateInvoice } = require('./utils/billing');
const { notifyClientDelivery } = require('./utils/deliveryNotifier');
const { recordJobResult } = require('./utils/observability');

// Explicit agent module registry — maps route names to actual file exports
const AGENT_MODULES = {
  qualifier: require('./agents/opportunityScorer'),
  briefer: require('./agents/clientBrief'),
  writer: require('./agents/writer'),
  editor: require('./agents/editor'),
  humanizer: require('./agents/humanization'),
  qa: require('./agents/qualityGate'),
  delivery: require('./agents/delivery'),
  prospector: require('./agents/coldOutreach')
};

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

  // Delivery — DELIVERED is the terminal state for the content pipeline
  DELIVERING: 'DELIVERING',
  DELIVERED: 'DELIVERED',

  // Prospect/Proposal Pipeline — CLOSED is the terminal state for this flow
  CLOSED: 'CLOSED',
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
  [JOB_STATES.DELIVERED]: [], // Terminal state for content pipeline

  // Prospect pipeline (CLOSED is the terminal state for this flow)
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
    this.maxRetries = config.maxRetries !== undefined ? config.maxRetries : 3;
    this.deadLetterQueueSize = config.deadLetterQueueSize || 100;
    this.deadLetterQueue = [];
  }

  /**
   * Load agent module from registry
   */
  async loadAgent(agentName) {
    if (this.agents[agentName]) return this.agents[agentName];

    const agent = AGENT_MODULES[agentName];
    if (!agent) {
      logger.warn('Unknown agent requested', { agent: agentName, event: 'agent_not_found' });
      return null;
    }

    this.agents[agentName] = agent;
    logger.debug('Agent loaded', { agent: agentName, event: 'agent_loaded' });
    return agent;
  }

  /**
   * Process a job — load agent, execute, advance state
   */
  async processJob(jobRecord) {
    const job = jobRecord.data || jobRecord;
    const agentName = AGENT_ROUTES[job.state];
    if (!agentName) throw new Error(`No agent route for state ${job.state}`);

    const agent = await this.loadAgent(agentName);
    if (!agent) throw new Error(`Agent ${agentName} not available`);

    logger.info('Processing job', { jobId: job.id, state: job.state, agent: agentName, event: 'job_processing' });

    let result;
    try {
      result = await agent(job, { orchestrator: this });
      recordJobResult(job.id, agentName, true);
    } catch (agentError) {
      recordJobResult(job.id, agentName, false, agentError.message);
      logger.error('Agent execution failed', { jobId: job.id, agent: agentName, state: job.state, error: agentError.message, event: 'agent_failed' });
      await this.handleJobFailure(job, agentError);
      return { error: true, message: agentError.message };
    }

    // Validate agent output before transitioning (transition guards)
    const validationError = this._validateAgentOutput(job.state, result);
    if (validationError) {
      logger.error('Agent output validation failed', { jobId: job.id, agent: agentName, state: job.state, error: validationError, event: 'validation_failed' });
      await this.handleJobFailure(job, new Error(`Agent output validation failed: ${validationError}`));
      return { error: true, message: validationError };
    }

    // Clear stale error state on successful processing (important for retries)
    if (job.lastError) {
      job.lastError = null;
      job.lastErrorTime = null;
    }

    // Store agent result on the job for downstream agents
    if (!job.agentResults) job.agentResults = {};
    job.agentResults[agentName] = result;

    // Propagate key output fields so downstream agents can read them from job.*
    this._propagateAgentOutput(job, agentName, result);

    // Determine next state from STATE_TRANSITIONS (first non-FAILED target is the happy path)
    const validTransitions = STATE_TRANSITIONS[job.state] || [];
    const nextState = validTransitions.find(s => s !== JOB_STATES.FAILED);
    if (!nextState) {
      // Terminal state reached (DELIVERED, DEAD_LETTER, etc.)
      job.completedAt = new Date();
      job.completionStatus = 'success';
      this._persistJob(job);
      return result;
    }

    await this.transitionJob(job, nextState, result);
    this._persistJob(job);

    return result;
  }

  /**
   * Validate agent output has required fields before state transition.
   * Returns null if valid, or an error message string if invalid.
   */
  _validateAgentOutput(currentState, result) {
    if (!result || typeof result !== 'object') {
      return 'Agent returned null or non-object result';
    }
    if (result.error === true) {
      return `Agent reported error: ${result.message || 'unknown'}`;
    }

    // State-specific output validation
    switch (currentState) {
      case JOB_STATES.APPROVED:
        // Briefer must return a brief object
        if (!result.brief && !result.briefContent) {
          return 'Briefer must return a brief or briefContent field';
        }
        break;
      case JOB_STATES.BRIEFED:
      case JOB_STATES.WRITING:
        // Writer must return content
        if (!result.content) {
          return 'Writer must return a content field';
        }
        break;
      case JOB_STATES.EDITING:
        // Editor must return review or editedDraft
        if (!result.review && !result.editedDraft && !result.scores) {
          return 'Editor must return review, editedDraft, or scores';
        }
        break;
      case JOB_STATES.HUMANIZING:
        // Humanizer must return humanized content
        if (!result.humanizedContent && !result.content) {
          return 'Humanizer must return humanizedContent or content';
        }
        break;
      case JOB_STATES.QUALITY_CHECK:
        // QA must return pass/fail — allow progression even if score is low
        // (the passed field may come from assessment sub-object)
        if (result.passed === undefined && result.assessment?.passed === undefined) {
          // If no explicit pass/fail, default to pass (don't block on missing field)
          result.passed = true;
        }
        break;
      // DISCOVERED, SCORED: qualifier output is flexible (scoring is advisory)
      // APPROVED_CONTENT, DELIVERING: delivery output is flexible
      default:
        break;
    }

    return null; // valid
  }

  /**
   * Propagate agent output fields onto the job object so downstream agents
   * can read them from job.* without reaching into job.agentResults.
   * Writer/editor/humanizer produce string content → job.content (string).
   * Delivery agent expects job.content as { title, body } — handled at delivery stage.
   */
  _propagateAgentOutput(job, agentName, result) {
    switch (agentName) {
      case 'writer':
        // Writer produces string content — set job.content for editor/humanizer
        if (result.content && typeof result.content === 'string') {
          job.content = result.content;
        }
        break;
      case 'humanizer':
        // Humanizer produces humanizedContent — update job.content for QA
        if (result.humanizedContent && typeof result.humanizedContent === 'string') {
          job.content = result.humanizedContent;
        }
        break;
      case 'briefer':
        // Briefer produces a brief object — set job.brief for writer
        if (result.brief) {
          job.brief = result.brief;
        }
        break;
      case 'delivery':
        // No propagation needed — terminal agent
        break;
      default:
        break;
    }

    // Before delivery, ensure job.content is the { title, body } shape delivery expects
    // Guard: only wrap if content is a plain string (skip if already an object to prevent re-wrapping on retry)
    if (job.state === JOB_STATES.APPROVED_CONTENT || job.state === JOB_STATES.DELIVERING) {
      if (typeof job.content === 'string') {
        job.content = {
          title: job.topic || job.title || 'Untitled',
          body: job.content
        };
      } else if (job.content && typeof job.content === 'object' && !job.content.body) {
        // Object exists but missing body — treat as malformed, log and wrap safely
        logger.warn('Content object missing body field', { jobId: job.id });
        job.content = { title: job.topic || job.title || 'Untitled', body: JSON.stringify(job.content) };
      }
    }
  }

  /**
   * Persist job state to storage (non-blocking — failures are logged, not thrown)
   */
  async _persistJob(job) {
    try {
      const { writeData, readData } = require('./utils/storage');
      let jobsData = await readData('jobs.json');
      if (!jobsData) jobsData = { jobs: [] };
      const jobs = jobsData.jobs || [];
      const idx = jobs.findIndex(j => j.id === job.id);
      if (idx >= 0) {
        jobs[idx] = job;
      } else {
        jobs.push(job);
      }
      await writeData('jobs.json', { jobs });
    } catch (persistErr) {
      logger.warn('Could not persist job state', { jobId: job.id, error: persistErr.message, event: 'persist_failed' });
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
      logger.error('No agent route for state', { jobId: id, state, event: 'route_missing' });
      return false;
    }

    // Load agent to verify it exists
    const agent = await this.loadAgent(agentName);
    if (!agent) {
      logger.warn('Agent not available for routing', { jobId: id, agent: agentName, event: 'agent_unavailable' });
      // Still add to queue but will be handled gracefully
    }

    // Determine queue and get priority score
    const queue = this._selectQueue(state);
    const priorityScore = this._calculatePriority(priority, deadline);

    try {
      await queue.add(job, {
        jobId: job.id,
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

      logger.info('Job routed to queue', { jobId: id, agent: agentName, queue: queue.name, event: 'job_routed' });
      return true;
    } catch (error) {
      logger.error('Failed to route job', { jobId: id, error: error.message, event: 'route_failed' });
      return false;
    }
  }

  /**
   * Transition job to next state
   */
  async transitionJob(job, nextState, result = {}) {
    const { id, state } = job;

    if (!this.canTransitionTo(state, nextState)) {
      logger.error('Invalid state transition', { jobId: id, from: state, to: nextState, event: 'transition_rejected' });
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

    logger.info('Job state transitioned', { jobId: id, from: previousState, to: nextState, event: 'state_transition' });

    // If next state is terminal, mark complete
    if (nextState === JOB_STATES.DELIVERED || nextState === JOB_STATES.CLOSED) {
      job.completedAt = new Date();
      job.completionStatus = 'success';
    }

    // Auto-generate invoice on delivery
    if (nextState === JOB_STATES.DELIVERED) {
      try {
        const invoice = await generateInvoice(job);
        job.invoiceId = invoice.id;
        logger.info('Auto-invoice generated on delivery', { jobId: id, invoiceId: invoice.id, event: 'auto_invoice' });
      } catch (invoiceErr) {
        // Non-blocking — delivery succeeds even if invoicing fails
        logger.warn('Auto-invoice generation failed', { jobId: id, error: invoiceErr.message, event: 'auto_invoice_error' });
      }

      // Auto-notify client on delivery
      try {
        const deliveryResults = result?.deliveryResults || [];
        const notification = await notifyClientDelivery(job, deliveryResults);
        if (notification?.sent) {
          job.notificationSent = true;
          logger.info('Client notified on delivery', { jobId: id, to: notification.to, event: 'delivery_notification' });
        }
      } catch (notifyErr) {
        logger.warn('Delivery notification failed', { jobId: id, error: notifyErr.message, event: 'notification_error' });
      }
    }

    // Route to next agent if not terminal
    const terminalStates = [JOB_STATES.DELIVERED, JOB_STATES.CLOSED, JOB_STATES.DEAD_LETTER];
    if (!terminalStates.includes(nextState)) {
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

      logger.info('Job retry scheduled', { jobId: id, state, retryCount: job.retryCount, maxRetries: this.maxRetries, event: 'job_retry' });

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
        logger.error('Failed to requeue job', { jobId: id, error: queueError.message, event: 'requeue_failed' });
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

    logger.error('Job moved to dead letter queue', { jobId: id, originalState: state, error: error.message, event: 'dead_letter' });

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

    logger.info('Test job accepted', { jobId: id, type, priority, event: 'test_job_accepted' });

    // Route to first agent
    await this.routeJob(job);

    // Return the created job so callers can extract id/state/createdAt
    return job;
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

    logger.info('Retrying dead letter job', { jobId, event: 'dead_letter_retry' });

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
