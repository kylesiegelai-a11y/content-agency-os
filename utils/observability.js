/**
 * Observability — Health Monitor, Alerting & Backup/Recovery
 *
 * 1. Health Monitor:  tracks system health, job pipeline stats, queue depth, error rates
 * 2. Alert Engine:    email alerts on critical failures, threshold breaches
 * 3. Backup/Recovery: data store backup to timestamped files, restore from backup
 */

const fs = require('fs');
const path = require('path');
const { readData, writeData } = require('./storage');
const logger = require('./logger');

// ── Constants ────────────────────────────────────────────────────────

const HEALTH_FILE = 'health.json';
const DATA_DIR = path.join(process.cwd(), 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

const ALERT_LEVELS = {
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'critical'
};

const ALERT_THRESHOLDS = {
  failedJobsPerHour: 5,         // CRITICAL if > 5 failed jobs/hour
  errorRatePercent: 20,         // WARNING if > 20% of jobs fail
  queueDepth: 50,               // WARNING if any queue > 50
  diskUsageMB: 500,             // WARNING if data dir > 500MB
  consecutiveFailures: 3,       // CRITICAL after 3 consecutive agent failures
  deliveryFailureRate: 30       // WARNING if > 30% deliveries fail
};

// Track in-memory for the current process
// NOTE: All mutations (recordJobResult, fireAlert) are synchronous within a single
// event-loop tick, so no async interleaving can produce inconsistent snapshots.
const processMetrics = {
  startedAt: new Date().toISOString(),
  jobsProcessed: 0,
  jobsFailed: 0,
  agentErrors: {},
  lastError: null,
  consecutiveFailures: 0,
  alerts: []
};

/**
 * Return a frozen snapshot of current metrics to prevent callers from
 * accidentally mutating the live counters.
 */
function getMetricsSnapshot() {
  return Object.freeze({
    startedAt: processMetrics.startedAt,
    jobsProcessed: processMetrics.jobsProcessed,
    jobsFailed: processMetrics.jobsFailed,
    agentErrors: { ...processMetrics.agentErrors },
    lastError: processMetrics.lastError ? { ...processMetrics.lastError } : null,
    consecutiveFailures: processMetrics.consecutiveFailures,
    alertCount: processMetrics.alerts.length
  });
}

// ═════════════════════════════════════════════════════════════════════
// 1. HEALTH MONITOR
// ═════════════════════════════════════════════════════════════════════

/**
 * Record a job completion (success or failure).
 */
function recordJobResult(jobId, agentName, success, errorMessage = null) {
  processMetrics.jobsProcessed++;
  if (!success) {
    processMetrics.jobsFailed++;
    processMetrics.consecutiveFailures++;
    processMetrics.lastError = {
      jobId,
      agent: agentName,
      error: errorMessage,
      at: new Date().toISOString()
    };

    // Track per-agent errors
    if (!processMetrics.agentErrors[agentName]) {
      processMetrics.agentErrors[agentName] = 0;
    }
    processMetrics.agentErrors[agentName]++;

    // Check if we should fire an alert
    if (processMetrics.consecutiveFailures >= ALERT_THRESHOLDS.consecutiveFailures) {
      fireAlert(ALERT_LEVELS.CRITICAL, 'consecutive_failures',
        `${processMetrics.consecutiveFailures} consecutive job failures — last: ${agentName} (${errorMessage})`);
    }
  } else {
    processMetrics.consecutiveFailures = 0;
  }
}

/**
 * Collect full system health snapshot.
 */
async function getHealthSnapshot() {
  const now = new Date();
  const uptimeMs = now - new Date(processMetrics.startedAt);

  // Job stats
  let jobStats = { total: 0, active: 0, completed: 0, failed: 0 };
  try {
    const jobsData = await readData('jobs.json');
    const jobs = (jobsData && jobsData.jobs) || [];
    jobStats.total = jobs.length;
    const terminalStates = ['DELIVERED', 'CLOSED'];
    const failedStates = ['FAILED', 'DEAD_LETTER'];
    jobStats.completed = jobs.filter(j => terminalStates.includes(j.state)).length;
    jobStats.failed = jobs.filter(j => failedStates.includes(j.state)).length;
    jobStats.active = jobStats.total - jobStats.completed - jobStats.failed;
  } catch { /* empty */ }

  // Data store sizes
  let dataStoreSizes = {};
  try {
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json') || f.endsWith('.db'));
    for (const file of files) {
      try {
        const stats = fs.statSync(path.join(DATA_DIR, file));
        dataStoreSizes[file] = {
          sizeBytes: stats.size,
          sizeKB: Math.round(stats.size / 1024 * 10) / 10,
          modified: stats.mtime.toISOString()
        };
      } catch { /* skip */ }
    }
  } catch { /* empty */ }

  // Total data size
  const totalDataBytes = Object.values(dataStoreSizes).reduce((s, f) => s + f.sizeBytes, 0);

  // Error rate
  const errorRate = processMetrics.jobsProcessed > 0
    ? Math.round((processMetrics.jobsFailed / processMetrics.jobsProcessed) * 100)
    : 0;

  // Active alerts
  const activeAlerts = checkThresholds(jobStats, errorRate, totalDataBytes);

  return {
    status: activeAlerts.some(a => a.level === ALERT_LEVELS.CRITICAL) ? 'critical' :
            activeAlerts.some(a => a.level === ALERT_LEVELS.WARNING) ? 'degraded' : 'healthy',
    timestamp: now.toISOString(),
    uptime: {
      ms: uptimeMs,
      human: formatUptime(uptimeMs)
    },
    process: {
      startedAt: processMetrics.startedAt,
      jobsProcessed: processMetrics.jobsProcessed,
      jobsFailed: processMetrics.jobsFailed,
      errorRate: `${errorRate}%`,
      consecutiveFailures: processMetrics.consecutiveFailures,
      lastError: processMetrics.lastError,
      agentErrors: processMetrics.agentErrors
    },
    jobs: jobStats,
    dataStores: dataStoreSizes,
    totalDataSizeMB: Math.round(totalDataBytes / (1024 * 1024) * 100) / 100,
    alerts: activeAlerts,
    recentAlerts: processMetrics.alerts.slice(-20).reverse(),
    thresholds: ALERT_THRESHOLDS
  };
}

function checkThresholds(jobStats, errorRate, totalDataBytes) {
  const alerts = [];

  if (errorRate > ALERT_THRESHOLDS.errorRatePercent) {
    alerts.push({
      level: ALERT_LEVELS.WARNING,
      type: 'high_error_rate',
      message: `Error rate ${errorRate}% exceeds threshold ${ALERT_THRESHOLDS.errorRatePercent}%`
    });
  }

  if (processMetrics.consecutiveFailures >= ALERT_THRESHOLDS.consecutiveFailures) {
    alerts.push({
      level: ALERT_LEVELS.CRITICAL,
      type: 'consecutive_failures',
      message: `${processMetrics.consecutiveFailures} consecutive failures`
    });
  }

  const totalMB = totalDataBytes / (1024 * 1024);
  if (totalMB > ALERT_THRESHOLDS.diskUsageMB) {
    alerts.push({
      level: ALERT_LEVELS.WARNING,
      type: 'disk_usage',
      message: `Data dir ${Math.round(totalMB)}MB exceeds ${ALERT_THRESHOLDS.diskUsageMB}MB`
    });
  }

  if (jobStats.failed > ALERT_THRESHOLDS.failedJobsPerHour) {
    alerts.push({
      level: ALERT_LEVELS.WARNING,
      type: 'high_failure_count',
      message: `${jobStats.failed} failed jobs`
    });
  }

  return alerts;
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

// ═════════════════════════════════════════════════════════════════════
// 2. ALERT ENGINE
// ═════════════════════════════════════════════════════════════════════

/**
 * Fire an alert. Logs it and optionally sends email for CRITICAL.
 */
function fireAlert(level, type, message) {
  const alert = {
    level,
    type,
    message,
    timestamp: new Date().toISOString()
  };

  processMetrics.alerts.push(alert);

  // Keep in-memory alerts bounded
  if (processMetrics.alerts.length > 200) {
    processMetrics.alerts = processMetrics.alerts.slice(-200);
  }

  if (level === ALERT_LEVELS.CRITICAL) {
    logger.error(`[ALERT:CRITICAL] ${type}: ${message}`);
    // Attempt email alert (non-blocking)
    sendAlertEmail(alert).catch(() => {});
  } else if (level === ALERT_LEVELS.WARNING) {
    logger.warn(`[ALERT:WARNING] ${type}: ${message}`);
  } else {
    logger.info(`[ALERT:INFO] ${type}: ${message}`);
  }
}

/**
 * Send a critical alert email via Gmail service.
 */
async function sendAlertEmail(alert) {
  try {
    const serviceFactory = require('./serviceFactory');
    const gmail = serviceFactory.getService('gmail');

    const alertEmail = process.env.ALERT_EMAIL || 'admin@content-agency-os.local';

    await gmail.sendMessage({
      to: alertEmail,
      from: 'alerts@content-agency-os.local',
      subject: `[ALERT:${alert.level.toUpperCase()}] ${alert.type}`,
      body: [
        `Content Agency OS Alert`,
        `========================`,
        ``,
        `Level: ${alert.level.toUpperCase()}`,
        `Type: ${alert.type}`,
        `Time: ${alert.timestamp}`,
        ``,
        `Message:`,
        alert.message,
        ``,
        `---`,
        `This is an automated alert from Content Agency OS.`
      ].join('\n')
    });

    logger.info('[observability] Alert email sent', { type: alert.type, to: alertEmail });
  } catch (err) {
    logger.warn('[observability] Failed to send alert email', { error: err.message });
  }
}

/**
 * Get all alerts (recent first).
 */
function getAlerts(limit = 50) {
  return processMetrics.alerts.slice(-limit).reverse();
}

// ═════════════════════════════════════════════════════════════════════
// 3. BACKUP / RECOVERY
// ═════════════════════════════════════════════════════════════════════

/**
 * Create a timestamped backup of all data stores.
 * Returns the backup folder path and list of backed-up files.
 */
async function createBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `backup_${timestamp}`);

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
  fs.mkdirSync(backupPath, { recursive: true });

  const dataFiles = [];
  try {
    const files = fs.readdirSync(DATA_DIR).filter(f =>
      (f.endsWith('.json') || f.endsWith('.db')) && !f.startsWith('.')
    );

    for (const file of files) {
      try {
        const src = path.join(DATA_DIR, file);
        const dest = path.join(backupPath, file);
        fs.copyFileSync(src, dest);
        const stats = fs.statSync(src);
        dataFiles.push({ file, sizeBytes: stats.size });
      } catch (err) {
        logger.warn(`[backup] Failed to backup ${file}`, { error: err.message });
      }
    }
  } catch (err) {
    logger.error('[backup] Failed to read data directory', { error: err.message });
    throw err;
  }

  const totalSize = dataFiles.reduce((s, f) => s + f.sizeBytes, 0);

  logger.info('[backup] Backup created', {
    path: backupPath,
    files: dataFiles.length,
    totalSizeKB: Math.round(totalSize / 1024)
  });

  return {
    backupPath,
    timestamp,
    files: dataFiles,
    totalSizeKB: Math.round(totalSize / 1024)
  };
}

/**
 * List available backups.
 */
function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];

  return fs.readdirSync(BACKUP_DIR)
    .filter(d => d.startsWith('backup_'))
    .sort()
    .reverse()
    .map(dir => {
      const fullPath = path.join(BACKUP_DIR, dir);
      let files = [];
      let totalSize = 0;
      try {
        files = fs.readdirSync(fullPath);
        for (const f of files) {
          try {
            totalSize += fs.statSync(path.join(fullPath, f)).size;
          } catch { /* skip */ }
        }
      } catch { /* empty dir */ }

      return {
        name: dir,
        path: fullPath,
        fileCount: files.length,
        totalSizeKB: Math.round(totalSize / 1024),
        timestamp: dir.replace('backup_', '').replace(/-/g, (m, i) => i < 19 ? (i === 10 ? 'T' : ':') : m)
      };
    });
}

/**
 * Restore from a specific backup.
 * Copies backup files back into the data directory.
 */
async function restoreBackup(backupName) {
  const backupPath = path.join(BACKUP_DIR, backupName);
  if (!fs.existsSync(backupPath)) {
    throw new Error(`Backup not found: ${backupName}`);
  }

  // First, create a pre-restore backup
  const safetyBackup = await createBackup();
  logger.info('[restore] Safety backup created before restore', { path: safetyBackup.backupPath });

  const restoredFiles = [];
  const files = fs.readdirSync(backupPath);

  for (const file of files) {
    try {
      const src = path.join(backupPath, file);
      const dest = path.join(DATA_DIR, file);
      fs.copyFileSync(src, dest);
      restoredFiles.push(file);
    } catch (err) {
      logger.warn(`[restore] Failed to restore ${file}`, { error: err.message });
    }
  }

  logger.info('[restore] Backup restored', {
    backup: backupName,
    filesRestored: restoredFiles.length,
    safetyBackup: safetyBackup.backupPath
  });

  return {
    restored: true,
    backup: backupName,
    filesRestored: restoredFiles,
    safetyBackup: safetyBackup.backupPath
  };
}

module.exports = {
  // Health
  getHealthSnapshot,
  recordJobResult,

  // Alerts
  fireAlert,
  sendAlertEmail,
  getAlerts,
  ALERT_LEVELS,
  ALERT_THRESHOLDS,

  // Backup/Recovery
  createBackup,
  listBackups,
  restoreBackup,

  // Internal
  processMetrics,
  getMetricsSnapshot
};
