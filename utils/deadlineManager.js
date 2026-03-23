/**
 * Deadline Manager
 * Monitors all active jobs for deadline proximity
 * Triggers alerts and communication agents at critical thresholds
 */

const logger = require('./logger');

class DeadlineManager {
  constructor(config = {}) {
    this.config = config;
    this.activeJobs = new Map();
    this.alerts = [];
    this.communicationLog = [];
    this.metrics = {
      jobsMonitored: 0,
      alertsTriggered: 0,
      communicationsSent: 0,
      escalations: 0,
      onTimeCompletion: 0,
      lateCompletion: 0
    };

    // Configuration thresholds
    this.thresholds = {
      fiftyPercent: config.fiftyPercentThreshold || 0.5, // 50% time remaining
      twentyFivePercent: config.twentyFivePercentThreshold || 0.25, // 25% time remaining
      overdue: config.overdueThreshold || 0 // 0% time remaining
    };
  }

  /**
   * Register a job for deadline monitoring
   * @param {Object} job - Job object with id, deadline, priority, etc
   */
  registerJob(job) {
    if (!job || !job.id || !job.deadline) {
      logger.warn('Invalid job for deadline registration');
      return false;
    }

    const deadlineTime = new Date(job.deadline).getTime();
    if (isNaN(deadlineTime)) {
      logger.warn(`Invalid deadline for job ${job.id}`);
      return false;
    }

    this.activeJobs.set(job.id, {
      id: job.id,
      title: job.title || job.data?.clientName || 'Unnamed Job',
      clientName: job.data?.clientName,
      deadline: new Date(job.deadline),
      priority: job.priority || 0,
      state: job.state,
      status50: false,
      status25: false,
      statusOverdue: false,
      createdAt: new Date(),
      lastCheckedAt: null,
      alertsTriggered: []
    });

    this.metrics.jobsMonitored++;
    logger.info(`[DeadlineManager] Job registered: ${job.id}`);

    return true;
  }

  /**
   * Unregister a completed or closed job
   * @param {string} jobId - Job ID to unregister
   */
  unregisterJob(jobId, completionStatus = 'completed') {
    const job = this.activeJobs.get(jobId);
    if (!job) {
      return false;
    }

    // Track completion metrics
    const now = new Date();
    if (now <= job.deadline) {
      this.metrics.onTimeCompletion++;
    } else {
      this.metrics.lateCompletion++;
    }

    this.activeJobs.delete(jobId);
    logger.info(`[DeadlineManager] Job unregistered: ${jobId} (${completionStatus})`);

    return true;
  }

  /**
   * Check all monitored jobs for deadline alerts
   * @returns {Object} Alert status and actions taken
   */
  checkAllDeadlines() {
    const now = new Date();
    const results = {
      timestamp: now,
      jobsChecked: this.activeJobs.size,
      alertsTriggered: [],
      communicationsRequired: [],
      escalationsRequired: []
    };

    for (const [jobId, job] of this.activeJobs) {
      const check = this._checkJobDeadline(jobId, job, now);

      if (check.alert50Percent && !job.status50) {
        job.status50 = true;
        const alert = this._createAlert(job, '50_PERCENT_REMAINING', check.timeRemaining);
        results.alertsTriggered.push(alert);
        job.alertsTriggered.push(alert);
        results.communicationsRequired.push(this._createCommunicationTask(job, 'status_update'));
      }

      if (check.alert25Percent && !job.status25) {
        job.status25 = true;
        const alert = this._createAlert(job, '25_PERCENT_REMAINING', check.timeRemaining);
        results.alertsTriggered.push(alert);
        job.alertsTriggered.push(alert);
        results.communicationsRequired.push(this._createCommunicationTask(job, 'urgent_alert'));
      }

      if (check.isOverdue && !job.statusOverdue) {
        job.statusOverdue = true;
        const alert = this._createAlert(job, 'OVERDUE', check.timeOverdue);
        results.alertsTriggered.push(alert);
        job.alertsTriggered.push(alert);
        results.escalationsRequired.push(this._createEscalation(job));
      }

      job.lastCheckedAt = now;
    }

    this.metrics.alertsTriggered += results.alertsTriggered.length;
    this.metrics.communicationsSent += results.communicationsRequired.length;
    this.metrics.escalations += results.escalationsRequired.length;

    return results;
  }

  /**
   * Check individual job deadline
   * @private
   */
  _checkJobDeadline(jobId, job, now) {
    const deadline = new Date(job.deadline).getTime();
    const currentTime = now.getTime();
    const totalTime = deadline - job.createdAt.getTime();
    const timeRemaining = deadline - currentTime;
    const percentRemaining = timeRemaining / totalTime;

    const isOverdue = timeRemaining <= 0;
    const alert50 = percentRemaining <= this.thresholds.fiftyPercent && percentRemaining > this.thresholds.twentyFivePercent;
    const alert25 = percentRemaining <= this.thresholds.twentyFivePercent && percentRemaining > this.thresholds.overdue;

    return {
      jobId,
      deadline: job.deadline,
      timeRemaining: Math.max(0, Math.floor(timeRemaining / (1000 * 60 * 60))), // Hours remaining
      percentRemaining: parseFloat((percentRemaining * 100).toFixed(1)),
      alert50Percent: alert50,
      alert25Percent: alert25,
      isOverdue,
      timeOverdue: isOverdue ? Math.floor(Math.abs(timeRemaining) / (1000 * 60 * 60)) : 0 // Hours overdue
    };
  }

  /**
   * Create alert object
   * @private
   */
  _createAlert(job, type, metric) {
    const alert = {
      id: `alert_${job.id}_${Date.now()}`,
      jobId: job.id,
      jobTitle: job.title,
      clientName: job.clientName,
      type,
      severity: type === 'OVERDUE' ? 'CRITICAL' : type === '25_PERCENT_REMAINING' ? 'HIGH' : 'MEDIUM',
      metric,
      createdAt: new Date(),
      acknowledged: false,
      actions: this._getAlertActions(type, job)
    };

    this.alerts.push(alert);
    return alert;
  }

  /**
   * Get recommended actions for alert
   * @private
   */
  _getAlertActions(alertType, job) {
    const actions = [];

    if (alertType === '50_PERCENT_REMAINING') {
      actions.push({
        action: 'SEND_STATUS_UPDATE',
        target: 'Client Communication Agent',
        priority: 'MEDIUM',
        description: 'Send status update to client'
      });
      actions.push({
        action: 'REVIEW_PROGRESS',
        target: 'Project Owner',
        priority: 'MEDIUM',
        description: 'Review job progress and confirm on-track'
      });
    } else if (alertType === '25_PERCENT_REMAINING') {
      actions.push({
        action: 'SEND_URGENT_UPDATE',
        target: 'Client Communication Agent',
        priority: 'HIGH',
        description: 'Send urgent status update to client'
      });
      actions.push({
        action: 'ESCALATE_TO_DASHBOARD',
        target: 'Owner Dashboard',
        priority: 'HIGH',
        description: 'Surface on priority dashboard'
      });
      actions.push({
        action: 'EXPEDITE_REMAINING_WORK',
        target: 'Content Production Team',
        priority: 'HIGH',
        description: 'Expedite remaining deliverables'
      });
    } else if (alertType === 'OVERDUE') {
      actions.push({
        action: 'CRITICAL_ESCALATION',
        target: 'Owner Dashboard',
        priority: 'CRITICAL',
        description: 'Critical escalation - job overdue'
      });
      actions.push({
        action: 'IMMEDIATE_CLIENT_CONTACT',
        target: 'Client Communication Agent',
        priority: 'CRITICAL',
        description: 'Immediate contact with client for explanation'
      });
      actions.push({
        action: 'EXPEDITED_DELIVERY_PLAN',
        target: 'Content Production Team',
        priority: 'CRITICAL',
        description: 'Create expedited delivery plan'
      });
    }

    return actions;
  }

  /**
   * Create communication task
   * @private
   */
  _createCommunicationTask(job, type) {
    const task = {
      id: `comm_${job.id}_${Date.now()}`,
      jobId: job.id,
      clientName: job.clientName,
      type,
      agent: 'Client Communication Agent',
      priority: type === 'urgent_alert' ? 'HIGH' : 'MEDIUM',
      messageTemplate: type === 'urgent_alert'
        ? `URGENT: Project "${job.title}" deadline approaching in 25% of time. Immediate action required.`
        : `STATUS UPDATE: Project "${job.title}" is 50% through timeline. Status: on track.`,
      scheduledFor: new Date(),
      status: 'pending',
      createdAt: new Date()
    };

    this.communicationLog.push(task);
    logger.info(`[DeadlineManager] Communication task created: ${task.id}`);

    return task;
  }

  /**
   * Create escalation
   * @private
   */
  _createEscalation(job) {
    const escalation = {
      id: `esc_${job.id}_${Date.now()}`,
      jobId: job.id,
      jobTitle: job.title,
      clientName: job.clientName,
      escalationType: 'OVERDUE_JOB',
      severity: 'CRITICAL',
      deadline: job.deadline,
      hoursOverdue: Math.floor((new Date() - new Date(job.deadline)) / (1000 * 60 * 60)),
      dashboardAlert: true,
      requiredActions: [
        'Immediate owner notification',
        'Client contact and explanation',
        'Recovery/catch-up plan',
        'Expedited delivery timeline'
      ],
      createdAt: new Date(),
      status: 'open'
    };

    logger.error(`[DeadlineManager] CRITICAL ESCALATION: Job ${job.id} is overdue`);
    return escalation;
  }

  /**
   * Get priority queue - jobs sorted by deadline urgency
   * @returns {Array} Sorted array of active jobs
   */
  getPriorityQueue() {
    const now = new Date();
    const queue = [];

    for (const [jobId, job] of this.activeJobs) {
      const deadline = new Date(job.deadline).getTime();
      const currentTime = now.getTime();
      const timeRemaining = deadline - currentTime;
      const totalTime = deadline - job.createdAt.getTime();
      const percentRemaining = timeRemaining / totalTime;

      queue.push({
        jobId: job.id,
        title: job.title,
        clientName: job.clientName,
        deadline: job.deadline,
        hoursRemaining: Math.max(0, Math.floor(timeRemaining / (1000 * 60 * 60))),
        percentRemaining: parseFloat((percentRemaining * 100).toFixed(1)),
        priority: job.priority,
        status: this._getJobPriorityStatus(percentRemaining),
        urgency: this._getUrgencyScore(percentRemaining),
        createdAt: job.createdAt
      });
    }

    // Sort by urgency (highest first), then by deadline
    return queue.sort((a, b) => {
      if (a.urgency !== b.urgency) {
        return b.urgency - a.urgency;
      }
      return a.deadline - b.deadline;
    });
  }

  /**
   * Get job priority status
   * @private
   */
  _getJobPriorityStatus(percentRemaining) {
    if (percentRemaining <= 0) {
      return 'OVERDUE';
    } else if (percentRemaining <= 0.25) {
      return 'CRITICAL';
    } else if (percentRemaining <= 0.5) {
      return 'HIGH';
    } else if (percentRemaining <= 0.75) {
      return 'MEDIUM';
    } else {
      return 'LOW';
    }
  }

  /**
   * Get urgency score for sorting (0-100)
   * @private
   */
  _getUrgencyScore(percentRemaining) {
    if (percentRemaining <= 0) {
      return 100;
    } else if (percentRemaining <= 0.25) {
      return 80;
    } else if (percentRemaining <= 0.5) {
      return 60;
    } else if (percentRemaining <= 0.75) {
      return 40;
    } else {
      return 20;
    }
  }

  /**
   * Get alerts
   * @param {Object} options - Filter options
   */
  getAlerts(options = {}) {
    let alerts = this.alerts;

    if (options.type) {
      alerts = alerts.filter(a => a.type === options.type);
    }

    if (options.severity) {
      alerts = alerts.filter(a => a.severity === options.severity);
    }

    if (options.unacknowledgedOnly) {
      alerts = alerts.filter(a => !a.acknowledged);
    }

    const limit = options.limit || 50;
    return alerts.slice(-limit).reverse();
  }

  /**
   * Acknowledge alert
   */
  acknowledgeAlert(alertId) {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      alert.acknowledgedAt = new Date();
      logger.info(`[DeadlineManager] Alert acknowledged: ${alertId}`);
      return true;
    }
    return false;
  }

  /**
   * Get communication log
   */
  getCommunicationLog(limit = 50) {
    return this.communicationLog.slice(-limit).reverse();
  }

  /**
   * Mark communication as sent
   */
  markCommunicationSent(commId) {
    const comm = this.communicationLog.find(c => c.id === commId);
    if (comm) {
      comm.status = 'sent';
      comm.sentAt = new Date();
      logger.info(`[DeadlineManager] Communication sent: ${commId}`);
      return true;
    }
    return false;
  }

  /**
   * Get active jobs dashboard summary
   */
  getDashboardSummary() {
    const now = new Date();
    const summary = {
      totalActive: this.activeJobs.size,
      byStatus: {
        overdue: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0
      },
      pendingCommunications: this.communicationLog.filter(c => c.status === 'pending').length,
      unacknowledgedAlerts: this.alerts.filter(a => !a.acknowledged).length,
      topUrgentJobs: [],
      metrics: {
        avgTimeToCompletion: this._calculateAvgTimeToCompletion(),
        onTimeRate: this._calculateOnTimeRate(),
        lateJobsCount: this.metrics.lateCompletion
      }
    };

    // Count by status
    for (const [jobId, job] of this.activeJobs) {
      const check = this._checkJobDeadline(jobId, job, now);
      const status = this._getJobPriorityStatus(check.percentRemaining / 100);
      summary.byStatus[status.toLowerCase()]++;
    }

    // Get top urgent jobs
    summary.topUrgentJobs = this.getPriorityQueue().slice(0, 5);

    return summary;
  }

  /**
   * Calculate average time to completion
   * @private
   */
  _calculateAvgTimeToCompletion() {
    if (this.metrics.onTimeCompletion + this.metrics.lateCompletion === 0) {
      return 'N/A';
    }

    return `${Math.round((this.metrics.onTimeCompletion / (this.metrics.onTimeCompletion + this.metrics.lateCompletion)) * 100)}% on-time`;
  }

  /**
   * Calculate on-time completion rate
   * @private
   */
  _calculateOnTimeRate() {
    const total = this.metrics.onTimeCompletion + this.metrics.lateCompletion;
    if (total === 0) {
      return 'N/A';
    }

    return parseFloat(((this.metrics.onTimeCompletion / total) * 100).toFixed(1)) + '%';
  }

  /**
   * Get metrics
   */
  getMetrics() {
    return {
      jobsMonitored: this.metrics.jobsMonitored,
      currentActiveJobs: this.activeJobs.size,
      alertsTriggered: this.metrics.alertsTriggered,
      communicationsSent: this.metrics.communicationsSent,
      escalations: this.metrics.escalations,
      completionMetrics: {
        onTime: this.metrics.onTimeCompletion,
        late: this.metrics.lateCompletion,
        onTimeRate: this._calculateOnTimeRate()
      },
      timestamp: new Date()
    };
  }

  /**
   * Clear all (for testing)
   */
  clearAll() {
    this.activeJobs.clear();
    this.alerts = [];
    this.communicationLog = [];
  }
}

module.exports = DeadlineManager;
