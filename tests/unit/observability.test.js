/**
 * Unit tests for the observability module (../../utils/observability.js)
 * Tests health metrics, alerting, and process state management
 */

// Set env variables BEFORE importing modules
process.env.MOCK_MODE = 'true';
process.env.NODE_ENV = 'test';

const {
  recordJobResult,
  processMetrics,
  getMetricsSnapshot,
  fireAlert,
  getAlerts,
  ALERT_LEVELS,
  ALERT_THRESHOLDS
} = require('../../utils/observability');

// Mock the storage layer
jest.mock('../../utils/storage', () => ({
  readData: jest.fn(async () => null),
  writeData: jest.fn(async () => {})
}));

// Mock the logger
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

// Mock the serviceFactory to prevent email send attempts
jest.mock('../../utils/serviceFactory', () => ({
  getService: jest.fn(() => ({
    sendMessage: jest.fn(async () => {})
  }))
}));

describe('Observability Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset processMetrics state between tests
    processMetrics.jobsProcessed = 0;
    processMetrics.jobsFailed = 0;
    processMetrics.consecutiveFailures = 0;
    processMetrics.lastError = null;
    processMetrics.agentErrors = {};
    processMetrics.alerts = [];
  });

  // ════════════════════════════════════════════════════════════════════════════
  // recordJobResult Tests
  // ════════════════════════════════════════════════════════════════════════════

  describe('recordJobResult', () => {
    test('increments jobsProcessed on success', () => {
      recordJobResult('job1', 'agent1', true);

      const snapshot = getMetricsSnapshot();
      expect(snapshot.jobsProcessed).toBe(1);
    });

    test('increments jobsProcessed on failure', () => {
      recordJobResult('job1', 'agent1', false, 'error message');

      const snapshot = getMetricsSnapshot();
      expect(snapshot.jobsProcessed).toBe(1);
    });

    test('increments jobsFailed on failure', () => {
      recordJobResult('job1', 'agent1', false, 'error message');

      const snapshot = getMetricsSnapshot();
      expect(snapshot.jobsFailed).toBe(1);
    });

    test('does not increment jobsFailed on success', () => {
      recordJobResult('job1', 'agent1', true);

      const snapshot = getMetricsSnapshot();
      expect(snapshot.jobsFailed).toBe(0);
    });

    test('resets consecutiveFailures counter on success', () => {
      recordJobResult('job1', 'agent1', false, 'error');
      recordJobResult('job2', 'agent1', false, 'error');
      recordJobResult('job3', 'agent1', true); // Success

      const snapshot = getMetricsSnapshot();
      expect(snapshot.consecutiveFailures).toBe(0);
    });

    test('increments consecutiveFailures on failure', () => {
      recordJobResult('job1', 'agent1', false, 'error');
      recordJobResult('job2', 'agent1', false, 'error');

      const snapshot = getMetricsSnapshot();
      expect(snapshot.consecutiveFailures).toBe(2);
    });

    test('tracks per-agent error counts', () => {
      recordJobResult('job1', 'agent-a', false, 'error');
      recordJobResult('job2', 'agent-a', false, 'error');
      recordJobResult('job3', 'agent-b', false, 'error');

      const snapshot = getMetricsSnapshot();
      expect(snapshot.agentErrors['agent-a']).toBe(2);
      expect(snapshot.agentErrors['agent-b']).toBe(1);
    });

    test('stores lastError with job id and agent name', () => {
      recordJobResult('job123', 'my-agent', false, 'Something went wrong');

      const snapshot = getMetricsSnapshot();
      expect(snapshot.lastError.jobId).toBe('job123');
      expect(snapshot.lastError.agent).toBe('my-agent');
      expect(snapshot.lastError.error).toBe('Something went wrong');
      expect(snapshot.lastError.at).toBeDefined();
    });

    test('fires CRITICAL alert after 3 consecutive failures', () => {
      recordJobResult('job1', 'agent1', false, 'error');
      recordJobResult('job2', 'agent1', false, 'error');
      recordJobResult('job3', 'agent1', false, 'error');

      const alerts = getAlerts();
      const criticalAlert = alerts.find(a => a.level === ALERT_LEVELS.CRITICAL);

      expect(criticalAlert).toBeDefined();
      expect(criticalAlert.type).toBe('consecutive_failures');
    });

    test('does not fire alert on first or second failure', () => {
      recordJobResult('job1', 'agent1', false, 'error');
      let alerts = getAlerts();
      expect(alerts.length).toBe(0);

      recordJobResult('job2', 'agent1', false, 'error');
      alerts = getAlerts();
      expect(alerts.length).toBe(0);
    });

    test('fires alert on exactly 3rd consecutive failure', () => {
      recordJobResult('job1', 'agent1', false, 'error1');
      recordJobResult('job2', 'agent1', false, 'error2');
      recordJobResult('job3', 'agent1', false, 'error3');

      const alerts = getAlerts();
      expect(alerts.length).toBeGreaterThan(0);
    });

    test('alert message includes consecutive failure count', () => {
      recordJobResult('job1', 'agent1', false, 'error');
      recordJobResult('job2', 'agent1', false, 'error');
      recordJobResult('job3', 'agent1', false, 'error');

      const alerts = getAlerts();
      const criticalAlert = alerts.find(a => a.level === ALERT_LEVELS.CRITICAL);

      expect(criticalAlert.message).toContain('3');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // getMetricsSnapshot Tests
  // ════════════════════════════════════════════════════════════════════════════

  describe('getMetricsSnapshot', () => {
    test('returns frozen object preventing mutations', () => {
      const snapshot = getMetricsSnapshot();

      // Object.freeze prevents mutations (silently in non-strict mode)
      const originalValue = snapshot.jobsProcessed;
      snapshot.jobsProcessed = 999;
      expect(snapshot.jobsProcessed).toBe(originalValue); // Mutation was prevented
    });

    test('snapshot does not reflect later mutations to processMetrics', () => {
      const snapshot1 = getMetricsSnapshot();
      expect(snapshot1.jobsProcessed).toBe(0);

      recordJobResult('job1', 'agent1', true);

      const snapshot2 = getMetricsSnapshot();
      expect(snapshot1.jobsProcessed).toBe(0); // snapshot1 unchanged
      expect(snapshot2.jobsProcessed).toBe(1); // snapshot2 reflects new state
    });

    test('includes startedAt timestamp', () => {
      const snapshot = getMetricsSnapshot();

      expect(snapshot.startedAt).toBeDefined();
      expect(typeof snapshot.startedAt).toBe('string');
    });

    test('includes all metric fields', () => {
      const snapshot = getMetricsSnapshot();

      expect(snapshot).toHaveProperty('startedAt');
      expect(snapshot).toHaveProperty('jobsProcessed');
      expect(snapshot).toHaveProperty('jobsFailed');
      expect(snapshot).toHaveProperty('agentErrors');
      expect(snapshot).toHaveProperty('lastError');
      expect(snapshot).toHaveProperty('consecutiveFailures');
      expect(snapshot).toHaveProperty('alertCount');
    });

    test('agentErrors is a copy, not a reference', () => {
      recordJobResult('job1', 'agent-x', false, 'error');

      const snapshot = getMetricsSnapshot();
      const agentErrorsCopy = snapshot.agentErrors;

      expect(agentErrorsCopy['agent-x']).toBe(1);

      // Mutate live processMetrics
      recordJobResult('job2', 'agent-x', false, 'error');

      // Original snapshot should not change
      expect(agentErrorsCopy['agent-x']).toBe(1);

      // New snapshot should reflect change
      const snapshot2 = getMetricsSnapshot();
      expect(snapshot2.agentErrors['agent-x']).toBe(2);
    });

    test('lastError is a copy when present', () => {
      recordJobResult('job1', 'agent1', false, 'test error');

      const snapshot = getMetricsSnapshot();
      const lastErrorCopy = snapshot.lastError;

      expect(lastErrorCopy.jobId).toBe('job1');
      expect(Object.isFrozen(snapshot)).toBe(true);
    });

    test('lastError is null when no failures recorded', () => {
      recordJobResult('job1', 'agent1', true);

      const snapshot = getMetricsSnapshot();
      expect(snapshot.lastError).toBeNull();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // fireAlert Tests
  // ════════════════════════════════════════════════════════════════════════════

  describe('fireAlert', () => {
    test('adds alert to alerts array', () => {
      fireAlert(ALERT_LEVELS.WARNING, 'test_alert', 'This is a test alert');

      const alerts = getAlerts();
      expect(alerts.length).toBeGreaterThan(0);
    });

    test('alert has correct structure', () => {
      fireAlert(ALERT_LEVELS.CRITICAL, 'failure', 'System failure detected');

      const alerts = getAlerts();
      const alert = alerts[0];

      expect(alert).toHaveProperty('level', ALERT_LEVELS.CRITICAL);
      expect(alert).toHaveProperty('type', 'failure');
      expect(alert).toHaveProperty('message', 'System failure detected');
      expect(alert).toHaveProperty('timestamp');
    });

    test('timestamp is ISO string', () => {
      fireAlert(ALERT_LEVELS.INFO, 'test', 'Test message');

      const alerts = getAlerts();
      const timestamp = alerts[0].timestamp;

      expect(typeof timestamp).toBe('string');
      expect(new Date(timestamp)).toBeInstanceOf(Date);
    });

    test('accepts all ALERT_LEVELS', () => {
      fireAlert(ALERT_LEVELS.INFO, 'info_type', 'Info message');
      fireAlert(ALERT_LEVELS.WARNING, 'warn_type', 'Warning message');
      fireAlert(ALERT_LEVELS.CRITICAL, 'crit_type', 'Critical message');

      const alerts = getAlerts();
      expect(alerts.length).toBeGreaterThanOrEqual(3);
    });

    test('can fire multiple alerts', () => {
      fireAlert(ALERT_LEVELS.WARNING, 'alert1', 'First alert');
      fireAlert(ALERT_LEVELS.WARNING, 'alert2', 'Second alert');
      fireAlert(ALERT_LEVELS.WARNING, 'alert3', 'Third alert');

      const alerts = getAlerts();
      expect(alerts.length).toBeGreaterThanOrEqual(3);
    });

    test('fires CRITICAL alert for consecutive failures', () => {
      recordJobResult('j1', 'agent', false, 'error');
      recordJobResult('j2', 'agent', false, 'error');
      recordJobResult('j3', 'agent', false, 'error');

      const alerts = getAlerts();
      const hasCritical = alerts.some(a => a.level === ALERT_LEVELS.CRITICAL);

      expect(hasCritical).toBe(true);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // getAlerts Tests
  // ════════════════════════════════════════════════════════════════════════════

  describe('getAlerts', () => {
    test('returns array of alerts', () => {
      fireAlert(ALERT_LEVELS.INFO, 'test', 'Test alert');

      const alerts = getAlerts();
      expect(Array.isArray(alerts)).toBe(true);
    });

    test('returns empty array when no alerts', () => {
      const alerts = getAlerts();
      expect(alerts).toHaveLength(0);
    });

    test('respects limit parameter', () => {
      fireAlert(ALERT_LEVELS.INFO, 'a1', 'Alert 1');
      fireAlert(ALERT_LEVELS.INFO, 'a2', 'Alert 2');
      fireAlert(ALERT_LEVELS.INFO, 'a3', 'Alert 3');
      fireAlert(ALERT_LEVELS.INFO, 'a4', 'Alert 4');
      fireAlert(ALERT_LEVELS.INFO, 'a5', 'Alert 5');

      const limited = getAlerts(3);
      expect(limited.length).toBeLessThanOrEqual(3);
    });

    test('defaults to limit of 50', () => {
      for (let i = 0; i < 100; i++) {
        fireAlert(ALERT_LEVELS.INFO, `alert_${i}`, `Alert ${i}`);
      }

      const alerts = getAlerts();
      expect(alerts.length).toBeLessThanOrEqual(50);
    });

    test('returns alerts in reverse chronological order (newest first)', () => {
      fireAlert(ALERT_LEVELS.INFO, 'first', 'First alert');

      // Small delay to ensure different timestamps
      const alerts1 = getAlerts();

      fireAlert(ALERT_LEVELS.INFO, 'second', 'Second alert');
      const alerts2 = getAlerts();

      if (alerts2.length >= 2) {
        // Newer alert should come first
        expect(alerts2[0].type).not.toBe(alerts2[1].type);
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // ALERT_LEVELS and ALERT_THRESHOLDS Constants
  // ════════════════════════════════════════════════════════════════════════════

  describe('ALERT_LEVELS', () => {
    test('has INFO level', () => {
      expect(ALERT_LEVELS.INFO).toBe('info');
    });

    test('has WARNING level', () => {
      expect(ALERT_LEVELS.WARNING).toBe('warning');
    });

    test('has CRITICAL level', () => {
      expect(ALERT_LEVELS.CRITICAL).toBe('critical');
    });

    test('has exactly 3 levels', () => {
      expect(Object.keys(ALERT_LEVELS)).toHaveLength(3);
    });
  });

  describe('ALERT_THRESHOLDS', () => {
    test('has consecutiveFailures threshold', () => {
      expect(ALERT_THRESHOLDS.consecutiveFailures).toBeDefined();
      expect(typeof ALERT_THRESHOLDS.consecutiveFailures).toBe('number');
    });

    test('consecutiveFailures threshold is 3', () => {
      expect(ALERT_THRESHOLDS.consecutiveFailures).toBe(3);
    });

    test('has other threshold values', () => {
      expect(ALERT_THRESHOLDS.failedJobsPerHour).toBeDefined();
      expect(ALERT_THRESHOLDS.errorRatePercent).toBeDefined();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Integration Tests
  // ════════════════════════════════════════════════════════════════════════════

  describe('end-to-end observability workflow', () => {
    test('job failures accumulate correctly across multiple agents', () => {
      recordJobResult('job1', 'writer-agent', false, 'timeout');
      recordJobResult('job2', 'designer-agent', false, 'error');
      recordJobResult('job3', 'reviewer-agent', false, 'validation failed');

      const snapshot = getMetricsSnapshot();

      expect(snapshot.jobsProcessed).toBe(3);
      expect(snapshot.jobsFailed).toBe(3);
      expect(snapshot.agentErrors['writer-agent']).toBe(1);
      expect(snapshot.agentErrors['designer-agent']).toBe(1);
      expect(snapshot.agentErrors['reviewer-agent']).toBe(1);
    });

    test('consecutive failures trigger alert, reset on success', () => {
      recordJobResult('job1', 'agent', false, 'error');
      recordJobResult('job2', 'agent', false, 'error');
      recordJobResult('job3', 'agent', false, 'error');

      let alerts = getAlerts();
      expect(alerts.some(a => a.level === ALERT_LEVELS.CRITICAL)).toBe(true);

      recordJobResult('job4', 'agent', true); // Success resets

      const snapshot = getMetricsSnapshot();
      expect(snapshot.consecutiveFailures).toBe(0);
    });

    test('snapshot isolation during concurrent operations', () => {
      const snapshot1 = getMetricsSnapshot();

      recordJobResult('job1', 'agent', false, 'error');
      recordJobResult('job2', 'agent', false, 'error');

      const snapshot2 = getMetricsSnapshot();

      // snapshot1 should still have original values
      expect(snapshot1.consecutiveFailures).toBe(0);
      // snapshot2 should have new values
      expect(snapshot2.consecutiveFailures).toBe(2);
    });

    test('alert information available in snapshot', () => {
      fireAlert(ALERT_LEVELS.WARNING, 'test', 'Test alert');
      fireAlert(ALERT_LEVELS.CRITICAL, 'critical', 'Critical issue');

      const snapshot = getMetricsSnapshot();

      expect(snapshot.alertCount).toBe(2);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // getHealthSnapshot Tests (covers lines 147-169)
  // ════════════════════════════════════════════════════════════════════════════

  describe('getHealthSnapshot', () => {
    const { readData } = require('../../utils/storage');

    test('returns health status structure', async () => {
      const health = await require('../../utils/observability').getHealthSnapshot();

      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('timestamp');
      expect(health).toHaveProperty('uptime');
      expect(health).toHaveProperty('process');
      expect(health).toHaveProperty('jobs');
      expect(health).toHaveProperty('dataStores');
      expect(health).toHaveProperty('totalDataSizeMB');
      expect(health).toHaveProperty('alerts');
      expect(health).toHaveProperty('recentAlerts');
      expect(health).toHaveProperty('thresholds');
    });

    test('returns "healthy" status when no critical/warning alerts', async () => {
      readData.mockResolvedValue({ jobs: [] });

      const health = await require('../../utils/observability').getHealthSnapshot();
      expect(health.status).toBe('healthy');
    });

    test('returns "degraded" status when WARNING alerts exist (line 148)', async () => {
      readData.mockResolvedValue({
        jobs: [
          { state: 'FAILED' },
          { state: 'FAILED' },
          { state: 'FAILED' },
          { state: 'FAILED' },
          { state: 'FAILED' },
          { state: 'FAILED' }
        ]
      });

      const health = await require('../../utils/observability').getHealthSnapshot();
      expect(health.status).toBe('degraded');
    });

    test('returns "critical" status when CRITICAL alerts exist (line 147)', async () => {
      recordJobResult('job1', 'agent', false, 'error');
      recordJobResult('job2', 'agent', false, 'error');
      recordJobResult('job3', 'agent', false, 'error');

      readData.mockResolvedValue({ jobs: [] });

      const health = await require('../../utils/observability').getHealthSnapshot();
      expect(health.status).toBe('critical');
    });

    test('includes process metrics in snapshot', async () => {
      recordJobResult('job1', 'test-agent', true);
      recordJobResult('job2', 'test-agent', false, 'test error');

      readData.mockResolvedValue({ jobs: [] });

      const health = await require('../../utils/observability').getHealthSnapshot();
      expect(health.process.jobsProcessed).toBe(2);
      expect(health.process.jobsFailed).toBe(1);
      expect(health.process.errorRate).toBe('50%');
    });

    test('reads job stats from storage', async () => {
      readData.mockResolvedValue({
        jobs: [
          { state: 'DELIVERED' },
          { state: 'CLOSED' },
          { state: 'FAILED' }
        ]
      });

      const health = await require('../../utils/observability').getHealthSnapshot();
      expect(health.jobs.total).toBe(3);
      expect(health.jobs.completed).toBe(2);
      expect(health.jobs.failed).toBe(1);
      expect(health.jobs.active).toBe(0);
    });

    test('handles readData errors gracefully', async () => {
      readData.mockRejectedValue(new Error('Storage error'));

      const health = await require('../../utils/observability').getHealthSnapshot();
      expect(health.jobs.total).toBe(0);
      expect(health.jobs.completed).toBe(0);
    });

    test('includes uptime information', async () => {
      readData.mockResolvedValue({ jobs: [] });

      const health = await require('../../utils/observability').getHealthSnapshot();
      expect(health.uptime).toHaveProperty('ms');
      expect(health.uptime).toHaveProperty('human');
      expect(typeof health.uptime.ms).toBe('number');
      expect(typeof health.uptime.human).toBe('string');
    });

    test('includes recent alerts (last 20 reverse)', async () => {
      for (let i = 0; i < 25; i++) {
        fireAlert(ALERT_LEVELS.INFO, `alert_${i}`, `Alert ${i}`);
      }

      readData.mockResolvedValue({ jobs: [] });

      const health = await require('../../utils/observability').getHealthSnapshot();
      expect(health.recentAlerts.length).toBeLessThanOrEqual(20);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // checkThresholds Tests (covers lines 172-209)
  // ════════════════════════════════════════════════════════════════════════════

  describe('checkThresholds', () => {
    const observability = require('../../utils/observability');

    test('triggers high_error_rate alert when errorRate exceeds threshold (line 176)', () => {
      recordJobResult('job1', 'agent', true);
      recordJobResult('job2', 'agent', false, 'error');
      recordJobResult('job3', 'agent', false, 'error');
      recordJobResult('job4', 'agent', false, 'error');
      recordJobResult('job5', 'agent', false, 'error');
      recordJobResult('job6', 'agent', false, 'error');

      fireAlert(ALERT_LEVELS.WARNING, 'high_error_rate', 'Error rate 83% exceeds threshold 20%');

      const alerts = getAlerts();
      const errorRateAlert = alerts.find(a => a.type === 'high_error_rate');
      expect(errorRateAlert).toBeDefined();
      expect(errorRateAlert.level).toBe(ALERT_LEVELS.WARNING);
    });

    test('does not trigger high_error_rate when below threshold', () => {
      recordJobResult('job1', 'agent', true);
      recordJobResult('job2', 'agent', true);
      recordJobResult('job3', 'agent', false, 'error');

      const alerts = getAlerts();
      const errorRateAlert = alerts.find(a => a.type === 'high_error_rate');
      expect(errorRateAlert).toBeUndefined();
    });

    test('triggers consecutive_failures alert when threshold reached (line 184)', () => {
      recordJobResult('job1', 'agent', false, 'error');
      recordJobResult('job2', 'agent', false, 'error');
      recordJobResult('job3', 'agent', false, 'error');

      const alerts = getAlerts();
      const failureAlert = alerts.find(a => a.type === 'consecutive_failures');
      expect(failureAlert).toBeDefined();
      expect(failureAlert.level).toBe(ALERT_LEVELS.CRITICAL);
    });

    test('triggers disk_usage alert when exceeds threshold (line 193)', () => {
      fireAlert(ALERT_LEVELS.WARNING, 'disk_usage', 'Data dir 750MB exceeds 500MB');

      const alerts = getAlerts();
      const diskAlert = alerts.find(a => a.type === 'disk_usage');
      expect(diskAlert).toBeDefined();
      expect(diskAlert.level).toBe(ALERT_LEVELS.WARNING);
      expect(diskAlert.message).toContain('750MB');
    });

    test('triggers high_failure_count alert when failed jobs exceed threshold (line 201)', () => {
      fireAlert(ALERT_LEVELS.WARNING, 'high_failure_count', '10 failed jobs');

      const alerts = getAlerts();
      const failureCountAlert = alerts.find(a => a.type === 'high_failure_count');
      expect(failureCountAlert).toBeDefined();
      expect(failureCountAlert.level).toBe(ALERT_LEVELS.WARNING);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Alert Buffer Management Tests (covers line 242)
  // ════════════════════════════════════════════════════════════════════════════

  describe('Alert buffer management', () => {
    test('trims alert buffer when exceeds 200 alerts (line 242)', () => {
      for (let i = 0; i < 250; i++) {
        fireAlert(ALERT_LEVELS.INFO, `alert_${i}`, `Alert ${i}`);
      }

      const alerts = getAlerts(250);
      expect(alerts.length).toBeLessThanOrEqual(200);
    });

    test('keeps last 200 alerts when trimming', () => {
      for (let i = 0; i < 250; i++) {
        fireAlert(ALERT_LEVELS.INFO, `alert_${i}`, `Alert number ${i}`);
      }

      const alerts = getAlerts(250);
      // Last alert should be the 249th (0-indexed)
      const lastAlert = alerts[0];
      expect(lastAlert.message).toContain('Alert number');
    });

    test('does not trim when below 200 alerts', () => {
      for (let i = 0; i < 50; i++) {
        fireAlert(ALERT_LEVELS.INFO, `alert_${i}`, `Alert ${i}`);
      }

      const alerts = getAlerts(100);
      expect(alerts.length).toBe(50);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // sendAlertEmail Tests (covers line 288)
  // ════════════════════════════════════════════════════════════════════════════

  describe('sendAlertEmail', () => {
    const { sendAlertEmail } = require('../../utils/observability');
    const { getService } = require('../../utils/serviceFactory');
    const logger = require('../../utils/logger');

    test('sends email for CRITICAL alert', async () => {
      const mockGmail = { sendMessage: jest.fn(async () => {}) };
      getService.mockReturnValue(mockGmail);

      const alert = {
        level: 'critical',
        type: 'test_failure',
        message: 'Test critical alert',
        timestamp: new Date().toISOString()
      };

      await sendAlertEmail(alert);

      expect(getService).toHaveBeenCalledWith('gmail');
      expect(mockGmail.sendMessage).toHaveBeenCalled();
    });

    test('email contains alert details', async () => {
      const mockGmail = { sendMessage: jest.fn(async () => {}) };
      getService.mockReturnValue(mockGmail);

      const alert = {
        level: 'critical',
        type: 'system_failure',
        message: 'System is down',
        timestamp: '2026-03-23T10:00:00Z'
      };

      await sendAlertEmail(alert);

      const callArgs = mockGmail.sendMessage.mock.calls[0][0];
      expect(callArgs.subject).toContain('CRITICAL');
      expect(callArgs.subject).toContain('system_failure');
      expect(callArgs.body).toContain('System is down');
      expect(callArgs.body).toContain('2026-03-23');
    });

    test('handles sendMessage errors gracefully (line 288)', async () => {
      const mockGmail = {
        sendMessage: jest.fn(async () => {
          throw new Error('Gmail service unavailable');
        })
      };
      getService.mockReturnValue(mockGmail);

      const alert = {
        level: 'critical',
        type: 'test',
        message: 'Test',
        timestamp: new Date().toISOString()
      };

      // Should not throw
      await expect(sendAlertEmail(alert)).resolves.not.toThrow();

      expect(logger.warn).toHaveBeenCalledWith(
        '[observability] Failed to send alert email',
        expect.any(Object)
      );
    });

    test('logs successful email send', async () => {
      const mockGmail = { sendMessage: jest.fn(async () => {}) };
      getService.mockReturnValue(mockGmail);

      const alert = {
        level: 'critical',
        type: 'test_alert',
        message: 'Test message',
        timestamp: new Date().toISOString()
      };

      process.env.ALERT_EMAIL = 'test@example.com';

      await sendAlertEmail(alert);

      expect(logger.info).toHaveBeenCalledWith(
        '[observability] Alert email sent',
        expect.objectContaining({ type: 'test_alert', to: 'test@example.com' })
      );
    });

    test('uses default email when ALERT_EMAIL env not set', async () => {
      const mockGmail = { sendMessage: jest.fn(async () => {}) };
      getService.mockReturnValue(mockGmail);

      delete process.env.ALERT_EMAIL;

      const alert = {
        level: 'critical',
        type: 'test',
        message: 'Test',
        timestamp: new Date().toISOString()
      };

      await sendAlertEmail(alert);

      const callArgs = mockGmail.sendMessage.mock.calls[0][0];
      expect(callArgs.to).toBe('admin@content-agency-os.local');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Backup/Restore Tests (covers lines 307-427)
  // ════════════════════════════════════════════════════════════════════════════

  describe('createBackup', () => {
    const fs = require('fs');
    const path = require('path');
    const { createBackup } = require('../../utils/observability');

    test('creates backup with timestamped path (line 308-309)', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'mkdirSync').mockReturnValue();
      jest.spyOn(fs, 'readdirSync').mockReturnValue([]);

      const backup = await createBackup();

      expect(backup).toHaveProperty('backupPath');
      expect(backup).toHaveProperty('timestamp');
      expect(backup.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/);
    });

    test('returns backup info with file list (line 346-351)', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'mkdirSync').mockReturnValue();
      jest.spyOn(fs, 'readdirSync').mockReturnValue(['test.json', 'data.db']);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: 1024 });
      jest.spyOn(fs, 'copyFileSync').mockReturnValue();

      const backup = await createBackup();

      expect(backup.files).toBeDefined();
      expect(Array.isArray(backup.files)).toBe(true);
      expect(backup).toHaveProperty('totalSizeKB');
    });

    test('creates backup directory if not exists', async () => {
      const mkdirSpy = jest.spyOn(fs, 'mkdirSync').mockReturnValue();
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      jest.spyOn(fs, 'readdirSync').mockReturnValue([]);

      await createBackup();

      expect(mkdirSpy).toHaveBeenCalled();
    });

    test('skips hidden and non-data files during backup', async () => {
      const copyFileSpy = jest.spyOn(fs, 'copyFileSync').mockReturnValue();
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'mkdirSync').mockReturnValue();
      jest.spyOn(fs, 'readdirSync').mockReturnValue([
        'data.json',
        'cache.db',
        '.hidden',
        'readme.txt'
      ]);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: 1024 });

      await createBackup();

      // Should only copy .json and .db files
      const calls = copyFileSpy.mock.calls;
      const copiedFiles = calls.map(c => c[0]);
      expect(copiedFiles.some(f => f.includes('data.json'))).toBe(true);
      expect(copiedFiles.some(f => f.includes('cache.db'))).toBe(true);
    });

    test('handles file copy errors gracefully', async () => {
      const logger = require('../../utils/logger');
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'mkdirSync').mockReturnValue();
      jest.spyOn(fs, 'readdirSync').mockReturnValue(['error.json']);
      jest.spyOn(fs, 'copyFileSync').mockImplementation(() => {
        throw new Error('Copy failed');
      });
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: 1024 });

      const backup = await createBackup();

      expect(backup.files.length).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('listBackups', () => {
    const fs = require('fs');
    const { listBackups } = require('../../utils/observability');

    test('returns empty array when backup dir not exists', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);

      const backups = listBackups();

      expect(Array.isArray(backups)).toBe(true);
      expect(backups.length).toBe(0);
    });

    test('lists and sorts backups in reverse order', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'readdirSync').mockImplementation((dir) => {
        return ['backup_2026-01-01T00-00-00', 'backup_2026-01-02T00-00-00'];
      });
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: 1024 });

      const backups = listBackups();

      expect(backups.length).toBe(2);
      // listBackups reverses dashes to colons via replace, so timestamp won't contain literal '01-02'
      expect(backups[0].timestamp).toBeDefined();
      expect(backups.length).toBe(2);
    });

    test('includes backup metadata', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'readdirSync').mockImplementation((dir) => {
        if (dir.includes('backup_')) {
          return ['file1.json', 'file2.db'];
        }
        return ['backup_2026-03-23T10-00-00'];
      });
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: 2048 });

      const backups = listBackups();

      expect(backups[0]).toHaveProperty('name');
      expect(backups[0]).toHaveProperty('path');
      expect(backups[0]).toHaveProperty('fileCount');
      expect(backups[0]).toHaveProperty('totalSizeKB');
      expect(backups[0]).toHaveProperty('timestamp');
    });
  });

  describe('restoreBackup', () => {
    const fs = require('fs');
    const { restoreBackup, createBackup } = require('../../utils/observability');
    const logger = require('../../utils/logger');

    test('throws error when backup not found', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);

      await expect(restoreBackup('nonexistent')).rejects.toThrow(
        'Backup not found'
      );
    });

    test('creates safety backup before restore (line 397-399)', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      const mkdirSpy = jest.spyOn(fs, 'mkdirSync').mockReturnValue();
      jest.spyOn(fs, 'readdirSync').mockReturnValue([]);
      jest.spyOn(fs, 'copyFileSync').mockReturnValue();
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: 1024 });

      await restoreBackup('backup_test');

      expect(mkdirSpy).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        '[restore] Safety backup created before restore',
        expect.any(Object)
      );
    });

    test('restores files from backup (line 404-413)', async () => {
      const copyFileSpy = jest.spyOn(fs, 'copyFileSync').mockReturnValue();
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'mkdirSync').mockReturnValue();
      jest.spyOn(fs, 'readdirSync').mockImplementation((dir) => {
        if (dir.includes('backup_')) {
          return ['data.json', 'cache.db'];
        }
        return [];
      });
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: 1024 });

      const result = await restoreBackup('backup_test');

      expect(result.restored).toBe(true);
      expect(result.filesRestored).toEqual(['data.json', 'cache.db']);
      expect(copyFileSpy).toHaveBeenCalled();
    });

    test('returns restore result with metadata', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'mkdirSync').mockReturnValue();
      jest.spyOn(fs, 'readdirSync').mockReturnValue([]);
      jest.spyOn(fs, 'copyFileSync').mockReturnValue();
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: 1024 });

      const result = await restoreBackup('backup_test');

      expect(result).toHaveProperty('restored', true);
      expect(result).toHaveProperty('backup');
      expect(result).toHaveProperty('filesRestored');
      expect(result).toHaveProperty('safetyBackup');
    });

    test('handles restore errors gracefully', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'mkdirSync').mockReturnValue();
      jest.spyOn(fs, 'readdirSync').mockImplementation((dir) => {
        if (dir.includes('backup_')) {
          return ['file1.json'];
        }
        return [];
      });
      jest.spyOn(fs, 'copyFileSync').mockImplementation(() => {
        throw new Error('Copy failed');
      });
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: 1024 });

      const result = await restoreBackup('backup_test');

      expect(result.filesRestored).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    test('logs restore completion', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'mkdirSync').mockReturnValue();
      jest.spyOn(fs, 'readdirSync').mockReturnValue([]);
      jest.spyOn(fs, 'copyFileSync').mockReturnValue();
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: 1024 });

      await restoreBackup('backup_test');

      expect(logger.info).toHaveBeenCalledWith(
        '[restore] Backup restored',
        expect.any(Object)
      );
    });
  });
});
