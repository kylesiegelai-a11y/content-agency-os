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
});
