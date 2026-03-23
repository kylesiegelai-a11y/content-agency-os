/**
 * Bull Queue Configuration with Mock Mode Support
 * Provides Redis-backed queues in production or in-memory fallback for development
 */

const Queue = require('bull');
const redis = require('redis');

const MOCK_MODE = process.env.MOCK_MODE === 'true';

/**
 * In-Memory Queue Implementation - mirrors Bull API for mock mode
 */
class InMemoryQueue {
  constructor(name, options = {}) {
    this.name = name;
    this.jobs = new Map();
    this.jobId = 0;
    this.processors = [];
    this.eventListeners = {
      completed: [],
      failed: [],
      stalled: [],
      progress: [],
      active: []
    };
  }

  async add(data, options = {}) {
    const queueJobId = options.jobId || data.id || ++this.jobId;
    const job = {
      id: queueJobId,
      data,
      state: 'waiting',
      progress: 0,
      attemptsMade: 0,
      attempts: options.attempts || 3,
      backoff: options.backoff || { type: 'exponential', delay: 2000 },
      delay: options.delay || 0,
      priority: options.priority || 0,
      timestamp: Date.now(),
      returnvalue: null,
      failedReason: null
    };

    this.jobs.set(queueJobId, job);

    // If there are processors and no delay, process immediately
    if (this.processors.length > 0 && job.delay === 0) {
      setImmediate(() => this._processJob(queueJobId));
    }

    return job;
  }

  async process(concurrency, processor) {
    // Support both (processor) and (concurrency, processor) signatures
    if (typeof concurrency === 'function') {
      processor = concurrency;
      concurrency = 1;
    }

    this.processors.push({ processor, concurrency });

    // Process existing waiting jobs
    for (const [jobId, job] of this.jobs) {
      if (job.state === 'waiting') {
        this._processJob(jobId);
      }
    }
  }

  async _processJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job || job.state !== 'waiting') return;

    job.state = 'active';
    this._emit('active', job);

    try {
      for (const { processor } of this.processors) {
        job.returnvalue = await processor(job);
      }
      job.state = 'completed';
      this._emit('completed', job);
    } catch (error) {
      job.attemptsMade++;
      if (job.attemptsMade < job.attempts) {
        job.state = 'waiting';
        const delay = this._calculateBackoff(job.attemptsMade, job.backoff);
        setTimeout(() => this._processJob(jobId), delay);
      } else {
        job.state = 'failed';
        job.failedReason = error.message;
        this._emit('failed', job, error);
      }
    }
  }

  _calculateBackoff(attempt, backoff) {
    if (backoff.type === 'exponential') {
      return backoff.delay * Math.pow(2, attempt - 1);
    }
    return backoff.delay;
  }

  on(event, handler) {
    if (this.eventListeners[event]) {
      this.eventListeners[event].push(handler);
    }
    return this;
  }

  _emit(event, ...args) {
    if (this.eventListeners[event]) {
      this.eventListeners[event].forEach(handler => handler(...args));
    }
  }

  async getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }

  async getJobCounts() {
    const counts = {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0
    };

    for (const job of this.jobs.values()) {
      if (counts.hasOwnProperty(job.state)) {
        counts[job.state]++;
      }
    }

    return counts;
  }

  async getJobs(states) {
    const jobs = [];
    for (const [, job] of this.jobs) {
      if (states.includes(job.state)) {
        jobs.push(job);
      }
    }
    return jobs;
  }

  async remove(jobId) {
    return this.jobs.delete(jobId);
  }

  async close() {
    this.jobs.clear();
    this.processors = [];
    this.eventListeners = {
      completed: [],
      failed: [],
      stalled: [],
      progress: [],
      active: []
    };
  }
}

/**
 * Queue Factory - creates appropriate queue type
 */
const createQueue = (name, options = {}) => {
  if (MOCK_MODE) {
    console.log(`[Queue] Creating in-memory queue: ${name}`);
    return new InMemoryQueue(name, options);
  }

  const redisUrl = process.env.REDIS_URL ||
                   `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`;

  console.log(`[Queue] Creating Bull queue: ${name} at ${redisUrl}`);

  const queue = new Queue(name, redisUrl, {
    defaultJobOptions: {
      attempts: options.attempts || 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      },
      removeOnComplete: false,
      removeOnFail: false
    },
    settings: {
      stalledInterval: 5000,
      maxStalledCount: 2,
      lockDuration: 30000,
      retryProcessDelay: 5000
    }
  });

  // Queue event handlers
  queue.on('completed', (job) => {
    console.log(`[${name}] Job ${job.id} completed`);
  });

  queue.on('failed', (job, err) => {
    console.error(`[${name}] Job ${job.id} failed: ${err.message}`);
  });

  queue.on('stalled', (job) => {
    console.warn(`[${name}] Job ${job.id} stalled`);
  });

  queue.on('error', (err) => {
    console.error(`[${name}] Queue error: ${err.message}`);
  });

  return queue;
};

/**
 * Initialize all queues for Content Agency OS
 */
const initializeQueues = async () => {
  const queues = {
    prospecting: createQueue('prospecting', { attempts: 3 }),
    writing: createQueue('writing', { attempts: 3 }),
    editing: createQueue('editing', { attempts: 3 }),
    communications: createQueue('communications', { attempts: 3 }),
    accounting: createQueue('accounting', { attempts: 2 })
  };

  console.log(`[Queues] Initialized ${Object.keys(queues).length} queues in ${MOCK_MODE ? 'MOCK' : 'PRODUCTION'} mode`);

  return queues;
};

/**
 * Graceful shutdown
 */
const closeQueues = async (queues) => {
  console.log('[Queues] Shutting down queues...');

  for (const [name, queue] of Object.entries(queues)) {
    try {
      await queue.close();
      console.log(`[Queues] Closed queue: ${name}`);
    } catch (error) {
      console.error(`[Queues] Error closing queue ${name}: ${error.message}`);
    }
  }
};

module.exports = {
  createQueue,
  initializeQueues,
  closeQueues,
  InMemoryQueue,
  MOCK_MODE
};
