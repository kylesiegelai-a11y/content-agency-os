/**
 * Scheduler.js Unit Tests
 * Comprehensive tests for the Scheduler class which manages cron jobs and pipeline cycles
 */

// Set environment variables before imports
process.env.MOCK_MODE = 'true';
process.env.NODE_ENV = 'test';

const { Scheduler } = require('../../scheduler');

// Mock dependencies
jest.mock('node-cron', () => ({
  schedule: jest.fn((expression, handler, options) => ({
    start: jest.fn(),
    stop: jest.fn()
  })),
  validate: jest.fn((expression) => true)
}));

jest.mock('../../utils/storage', () => ({
  storage: {
    append: jest.fn(() => Promise.resolve())
  }
}));

const cron = require('node-cron');
const { storage } = require('../../utils/storage');

describe('Scheduler Class', () => {
  let scheduler;
  let mockOrchestrator;
  let mockConfig;

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Create mock orchestrator
    mockOrchestrator = {
      queues: {
        prospecting: {
          getJobs: jest.fn().mockResolvedValue([])
        }
      },
      getQueueStats: jest.fn().mockResolvedValue({ waiting: 0, active: 0 }),
      acceptTestJob: jest.fn().mockResolvedValue({ id: 'test-job' })
    };

    // Create mock config
    mockConfig = {
      killSwitch: false,
      agentPauseStates: {}
    };

    // Create fresh scheduler instance
    scheduler = new Scheduler(mockOrchestrator, mockConfig);
  });

  // ========================
  // Constructor Tests (3 tests)
  // ========================
  describe('Constructor', () => {
    test('Should create instance with default config', () => {
      const defaultScheduler = new Scheduler(mockOrchestrator);
      expect(defaultScheduler).toBeInstanceOf(Scheduler);
      expect(defaultScheduler.config).toEqual({});
    });

    test('Should store orchestrator reference', () => {
      expect(scheduler.orchestrator).toBe(mockOrchestrator);
    });

    test('Should initialize empty tasks Map', () => {
      expect(scheduler.tasks).toBeInstanceOf(Map);
      expect(scheduler.tasks.size).toBe(0);
    });
  });

  // ========================
  // initialize() Tests (4 tests)
  // ========================
  describe('initialize()', () => {
    test('Should create 6 scheduled tasks', async () => {
      const result = await scheduler.initialize();
      expect(scheduler.tasks.size).toBe(6);
    });

    test('Should return true on success', async () => {
      const result = await scheduler.initialize();
      expect(result).toBe(true);
    });

    test('Should create each task with correct properties', async () => {
      await scheduler.initialize();
      const tasks = Array.from(scheduler.tasks.values());

      tasks.forEach((task) => {
        expect(task).toHaveProperty('id');
        expect(task).toHaveProperty('cronExpression');
        expect(task).toHaveProperty('status');
        expect(task.status).toBe('scheduled');
      });
    });

    test('Should still return true if one scheduleTask throws (error is caught per-task)', async () => {
      cron.schedule.mockImplementationOnce(() => {
        throw new Error('Schedule failed');
      });

      const result = await scheduler.initialize();
      // scheduleTask catches errors internally, so initialize still succeeds
      expect(result).toBe(true);
      // But the failing task won't be in the tasks map
      expect(scheduler.tasks.size).toBeLessThan(6);
    });
  });

  // ========================
  // scheduleTask() Tests (5 tests)
  // ========================
  describe('scheduleTask()', () => {
    test('Should add task to Map with correct structure', () => {
      const taskId = 'test-task';
      const cronExpr = '0 9 * * *';
      const handler = jest.fn();
      const description = 'Test task';

      scheduler.scheduleTask(taskId, cronExpr, handler, description);

      expect(scheduler.tasks.has(taskId)).toBe(true);
      const task = scheduler.tasks.get(taskId);
      expect(task.id).toBe(taskId);
      expect(task.cronExpression).toBe(cronExpr);
      expect(task.description).toBe(description);
      expect(task.handler).toBe(handler);
    });

    test('Should call cron.schedule with correct expression', () => {
      const cronExpr = '*/15 * * * *';
      scheduler.scheduleTask('test-task', cronExpr, jest.fn(), 'Test');

      expect(cron.schedule).toHaveBeenCalledWith(
        cronExpr,
        expect.any(Function),
        expect.objectContaining({
          scheduled: true,
          runOnInit: false
        })
      );
    });

    test('Should return null for invalid cron expression', () => {
      cron.validate.mockReturnValueOnce(false);
      const result = scheduler.scheduleTask('bad-task', 'invalid-cron', jest.fn());

      expect(result).toBeNull();
    });

    test('Should initialize task with correct default values', () => {
      scheduler.scheduleTask('new-task', '0 9 * * *', jest.fn());
      const task = scheduler.tasks.get('new-task');

      expect(task.runCount).toBe(0);
      expect(task.lastRun).toBeNull();
      expect(task.lastError).toBeNull();
    });

    test('Should overwrite duplicate taskId', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      scheduler.scheduleTask('duplicate', '0 9 * * *', handler1, 'First');
      scheduler.scheduleTask('duplicate', '0 10 * * *', handler2, 'Second');

      const task = scheduler.tasks.get('duplicate');
      expect(task.handler).toBe(handler2);
      expect(task.description).toBe('Second');
      expect(task.cronExpression).toBe('0 10 * * *');
    });
  });

  // ========================
  // _executeTask() Tests (6 tests)
  // ========================
  describe('_executeTask()', () => {
    test('Should call handler when shouldRunTask returns true', async () => {
      const handler = jest.fn();
      scheduler.scheduleTask('test-task', '0 9 * * *', handler);

      await scheduler._executeTask(scheduler.tasks.get('test-task'));
      expect(handler).toHaveBeenCalled();
    });

    test('Should increment runCount after success', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      scheduler.scheduleTask('test-task', '0 9 * * *', handler);
      const task = scheduler.tasks.get('test-task');

      expect(task.runCount).toBe(0);
      await scheduler._executeTask(task);
      expect(task.runCount).toBe(1);
    });

    test('Should set lastRun to Date after execution', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      scheduler.scheduleTask('test-task', '0 9 * * *', handler);
      const task = scheduler.tasks.get('test-task');

      const beforeRun = new Date();
      await scheduler._executeTask(task);
      const afterRun = new Date();

      expect(task.lastRun).toBeInstanceOf(Date);
      expect(task.lastRun.getTime()).toBeGreaterThanOrEqual(beforeRun.getTime());
      expect(task.lastRun.getTime()).toBeLessThanOrEqual(afterRun.getTime());
    });

    test('Should set status to running during execution and back to scheduled after', async () => {
      const statusTracker = [];
      const handler = jest.fn(async () => {
        statusTracker.push(task.status);
      });

      scheduler.scheduleTask('test-task', '0 9 * * *', handler);
      const task = scheduler.tasks.get('test-task');

      await scheduler._executeTask(task);

      expect(statusTracker[0]).toBe('running');
      expect(task.status).toBe('scheduled');
    });

    test('Should emit task-completed event with taskId and duration', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      scheduler.scheduleTask('test-task', '0 9 * * *', handler);
      const task = scheduler.tasks.get('test-task');

      const eventListener = jest.fn();
      scheduler.on('task-completed', eventListener);

      await scheduler._executeTask(task);

      expect(eventListener).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'test-task',
          duration: expect.any(Number)
        })
      );
    });

    test('Should handle handler failure: set status=error, lastError=message, emit task-failed', async () => {
      const error = new Error('Handler failed');
      const handler = jest.fn().mockRejectedValue(error);
      scheduler.scheduleTask('test-task', '0 9 * * *', handler);
      const task = scheduler.tasks.get('test-task');

      const failureListener = jest.fn();
      scheduler.on('task-failed', failureListener);

      await scheduler._executeTask(task);

      expect(task.status).toBe('error');
      expect(task.lastError).toBe('Handler failed');
      expect(failureListener).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'test-task',
          error: 'Handler failed'
        })
      );
    });
  });

  // ========================
  // _shouldRunTask() Tests (5 tests)
  // ========================
  describe('_shouldRunTask()', () => {
    test('Should return false when killSwitch=true', () => {
      scheduler.config.killSwitch = true;
      const result = scheduler._shouldRunTask('any-task');
      expect(result).toBe(false);
    });

    test('Should return true when killSwitch=false and no agents paused', () => {
      scheduler.config.killSwitch = false;
      scheduler.config.agentPauseStates = {};

      const result = scheduler._shouldRunTask('pipeline-cycle');
      expect(result).toBe(true);
    });

    test('Should return false when all required agents for a task are paused', () => {
      scheduler.config.killSwitch = false;
      scheduler.config.agentPauseStates = {
        writer: true,
        editor: true,
        qa: true,
        delivery: true
      };

      const result = scheduler._shouldRunTask('pipeline-cycle');
      expect(result).toBe(false);
    });

    test('Should return true for unknown taskId (no agents to check)', () => {
      scheduler.config.killSwitch = false;
      scheduler.config.agentPauseStates = {};

      const result = scheduler._shouldRunTask('unknown-task');
      expect(result).toBe(true);
    });

    test('Should check agent pause states from config.agentPauseStates', () => {
      scheduler.config.killSwitch = false;
      scheduler.config.agentPauseStates = {
        prospector: true,
        qualifier: false
      };

      const result = scheduler._shouldRunTask('cold-outreach');
      expect(result).toBe(false);
    });
  });

  // ========================
  // _runPipelineCycle() Tests (2 tests)
  // ========================
  describe('_runPipelineCycle()', () => {
    test('Should call orchestrator.getQueueStats', async () => {
      await scheduler._runPipelineCycle();
      expect(mockOrchestrator.getQueueStats).toHaveBeenCalled();
    });

    test('Should call _logActivity with PIPELINE_CYCLE_RUN', async () => {
      await scheduler._runPipelineCycle();

      expect(storage.append).toHaveBeenCalledWith(
        'activity.json',
        expect.objectContaining({
          action: 'PIPELINE_CYCLE_RUN'
        })
      );
    });
  });

  // ========================
  // _runColdOutreachCycle() Tests (2 tests)
  // ========================
  describe('_runColdOutreachCycle()', () => {
    test('Should create jobs via orchestrator.acceptTestJob', async () => {
      await scheduler._runColdOutreachCycle();
      expect(mockOrchestrator.acceptTestJob).toHaveBeenCalled();
    });

    test('Should call _logActivity with COLD_OUTREACH_CYCLE action', async () => {
      await scheduler._runColdOutreachCycle();

      expect(storage.append).toHaveBeenCalledWith(
        'activity.json',
        expect.objectContaining({
          action: 'COLD_OUTREACH_CYCLE'
        })
      );
    });
  });

  // ========================
  // getTasks() Tests (3 tests)
  // ========================
  describe('getTasks()', () => {
    test('Should return array of task objects', async () => {
      await scheduler.initialize();
      const tasks = scheduler.getTasks();

      expect(Array.isArray(tasks)).toBe(true);
      expect(tasks.length).toBe(6);
    });

    test('Should return objects with required properties', async () => {
      await scheduler.initialize();
      const tasks = scheduler.getTasks();

      tasks.forEach((task) => {
        expect(task).toHaveProperty('id');
        expect(task).toHaveProperty('cronExpression');
        expect(task).toHaveProperty('description');
        expect(task).toHaveProperty('status');
        expect(task).toHaveProperty('runCount');
      });
    });

    test('Should exclude internal cronJob and handler from returned objects', async () => {
      await scheduler.initialize();
      const tasks = scheduler.getTasks();

      tasks.forEach((task) => {
        expect(task).not.toHaveProperty('cronJob');
        expect(task).not.toHaveProperty('handler');
      });
    });
  });

  // ========================
  // getTask() Tests (2 tests)
  // ========================
  describe('getTask()', () => {
    test('Should return task data for valid taskId', async () => {
      scheduler.scheduleTask('my-task', '0 9 * * *', jest.fn(), 'My task');
      const task = scheduler.getTask('my-task');

      expect(task).not.toBeNull();
      expect(task.id).toBe('my-task');
      expect(task.cronExpression).toBe('0 9 * * *');
    });

    test('Should return null for unknown taskId', () => {
      const task = scheduler.getTask('nonexistent');
      expect(task).toBeNull();
    });
  });

  // ========================
  // pauseTask() / resumeTask() Tests (4 tests)
  // ========================
  describe('pauseTask() / resumeTask()', () => {
    test('Should call cronJob.stop() and set status=paused when pausing', async () => {
      scheduler.scheduleTask('test-task', '0 9 * * *', jest.fn());
      const task = scheduler.tasks.get('test-task');
      const mockCronJob = task.cronJob;

      scheduler.pauseTask('test-task');

      expect(mockCronJob.stop).toHaveBeenCalled();
      expect(task.status).toBe('paused');
    });

    test('Should return false for unknown taskId when pausing', () => {
      const result = scheduler.pauseTask('nonexistent');
      expect(result).toBe(false);
    });

    test('Should call cronJob.start() and set status=scheduled when resuming', async () => {
      scheduler.scheduleTask('test-task', '0 9 * * *', jest.fn());
      const task = scheduler.tasks.get('test-task');
      const mockCronJob = task.cronJob;

      scheduler.pauseTask('test-task');
      scheduler.resumeTask('test-task');

      expect(mockCronJob.start).toHaveBeenCalled();
      expect(task.status).toBe('scheduled');
    });

    test('Should return false for unknown taskId when resuming', () => {
      const result = scheduler.resumeTask('nonexistent');
      expect(result).toBe(false);
    });
  });

  // ========================
  // shutdown() Tests (2 tests)
  // ========================
  describe('shutdown()', () => {
    test('Should stop all cronJobs', async () => {
      await scheduler.initialize();
      const tasks = Array.from(scheduler.tasks.values());

      await scheduler.shutdown();

      tasks.forEach((task) => {
        expect(task.cronJob.stop).toHaveBeenCalled();
      });
    });

    test('Should clear the tasks Map', async () => {
      await scheduler.initialize();
      expect(scheduler.tasks.size).toBeGreaterThan(0);

      await scheduler.shutdown();

      expect(scheduler.tasks.size).toBe(0);
    });
  });

  // ========================
  // _logActivity() Tests (2 tests)
  // ========================
  describe('_logActivity()', () => {
    test('Should call storage.append with action and details', () => {
      const action = 'TEST_ACTION';
      const details = { testKey: 'testValue' };

      scheduler._logActivity(action, details);

      expect(storage.append).toHaveBeenCalledWith(
        'activity.json',
        expect.objectContaining({
          action,
          testKey: 'testValue'
        })
      );
    });

    test('Should handle storage.append errors gracefully', async () => {
      storage.append.mockRejectedValueOnce(new Error('Storage failed'));

      // Should not throw
      expect(() => {
        scheduler._logActivity('TEST_ACTION', {});
      }).not.toThrow();
    });
  });

  // ========================
  // Integration Tests
  // ========================
  describe('Integration Tests', () => {
    test('Should skip task execution when shouldRunTask returns false', async () => {
      const handler = jest.fn();
      scheduler.config.killSwitch = true;
      scheduler.scheduleTask('test-task', '0 9 * * *', handler);

      const task = scheduler.tasks.get('test-task');
      await scheduler._executeTask(task);

      expect(handler).not.toHaveBeenCalled();
    });

    test('Should maintain task metrics through multiple executions', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      scheduler.scheduleTask('metrics-task', '0 9 * * *', handler);
      const task = scheduler.tasks.get('metrics-task');

      await scheduler._executeTask(task);
      expect(task.runCount).toBe(1);

      await scheduler._executeTask(task);
      expect(task.runCount).toBe(2);
    });

    test('Should persist error information from failed tasks', async () => {
      const error = new Error('Task execution error');
      const handler = jest.fn().mockRejectedValue(error);
      scheduler.scheduleTask('error-task', '0 9 * * *', handler);

      const task = scheduler.tasks.get('error-task');
      await scheduler._executeTask(task);

      expect(task.lastError).toBe('Task execution error');
      expect(task.status).toBe('error');
    });

    test('Should handle pause/resume cycle correctly', async () => {
      scheduler.scheduleTask('cycle-task', '0 9 * * *', jest.fn());
      const task = scheduler.tasks.get('cycle-task');

      expect(task.status).toBe('scheduled');

      scheduler.pauseTask('cycle-task');
      expect(task.status).toBe('paused');

      scheduler.resumeTask('cycle-task');
      expect(task.status).toBe('scheduled');
    });

    test('Should initialize all 6 standard scheduler tasks', async () => {
      await scheduler.initialize();
      const taskIds = Array.from(scheduler.tasks.keys());

      expect(taskIds).toContain('pipeline-cycle');
      expect(taskIds).toContain('cold-outreach');
      expect(taskIds).toContain('re-engagement');
      expect(taskIds).toContain('niche-expansion');
      expect(taskIds).toContain('gmail-monitoring');
      expect(taskIds).toContain('accounting-summary');
    });

    test('Should log activity for successful task completion', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      scheduler.scheduleTask('log-task', '0 9 * * *', handler);
      const task = scheduler.tasks.get('log-task');

      await scheduler._executeTask(task);

      expect(storage.append).toHaveBeenCalledWith(
        'activity.json',
        expect.objectContaining({
          action: 'TASK_COMPLETED',
          taskId: 'log-task'
        })
      );
    });

    test('Should log activity for task failure', async () => {
      const error = new Error('Execution failed');
      const handler = jest.fn().mockRejectedValue(error);
      scheduler.scheduleTask('fail-task', '0 9 * * *', handler);
      const task = scheduler.tasks.get('fail-task');

      await scheduler._executeTask(task);

      expect(storage.append).toHaveBeenCalledWith(
        'activity.json',
        expect.objectContaining({
          action: 'TASK_FAILED',
          taskId: 'fail-task',
          error: 'Execution failed'
        })
      );
    });
  });
});
