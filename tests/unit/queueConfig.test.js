process.env.MOCK_MODE = 'true';
process.env.NODE_ENV = 'test';

const { InMemoryQueue, initializeQueues, createQueue, closeQueues } = require('../../utils/queueConfig');

describe('queueConfig', () => {

  describe('Queue creation', () => {
    test('createQueue returns InMemoryQueue in MOCK_MODE', () => {
      const queue = createQueue('test-queue');
      expect(queue).toBeInstanceOf(InMemoryQueue);
      expect(queue.name).toBe('test-queue');
    });

    test('initializeQueues returns object with expected queue names', async () => {
      const queues = await initializeQueues();
      expect(queues.prospecting).toBeDefined();
      expect(queues.writing).toBeDefined();
      expect(queues.editing).toBeDefined();
      expect(queues.communications).toBeDefined();
      // Cleanup
      for (const q of Object.values(queues)) await q.close();
    });
  });

  describe('InMemoryQueue', () => {
    let queue;

    beforeEach(() => {
      queue = new InMemoryQueue('test');
    });

    afterEach(() => {
      queue.close();
    });

    test('add() returns job with id, data, state=waiting, progress=0', async () => {
      const job = await queue.add({ content: 'hello' });
      expect(job.id).toBeDefined();
      expect(job.data).toEqual({ content: 'hello' });
      expect(job.state).toBe('waiting');
      expect(job.progress).toBe(0);
    });

    test('add() respects provided jobId option', async () => {
      const job = await queue.add({ content: 'hello' }, { jobId: 'custom-id' });
      expect(job.id).toBe('custom-id');
    });

    test('add() auto-increments jobId when not provided', async () => {
      const job1 = await queue.add({ content: 'job1' });
      const job2 = await queue.add({ content: 'job2' });
      expect(job1.id).not.toBe(job2.id);
    });

    test('process() registers a processor function', () => {
      const processor = jest.fn();
      queue.process(processor);
      expect(queue.processors.length).toBe(1);
    });

    test('process() supports (concurrency, processor) signature', () => {
      const processor = jest.fn();
      queue.process(2, processor);
      expect(queue.processors.length).toBe(1);
    });

    test('process() runs processor on waiting jobs', async () => {
      const processor = jest.fn(() => Promise.resolve());
      await queue.add({ content: 'test' });
      queue.process(processor);
      // Wait for setImmediate/async processing
      await new Promise(r => setTimeout(r, 50));
      expect(processor).toHaveBeenCalled();
    });

    test('_processJob sets state to active during processing', async () => {
      let capturedState = null;
      const processor = (job) => {
        capturedState = job.state;
        return Promise.resolve();
      };
      queue.process(processor);
      await queue.add({ content: 'test' });
      await new Promise(r => setTimeout(r, 50));
      expect(capturedState).toBe('active');
    });

    test('_processJob sets state to completed after success', async () => {
      const processor = (job) => Promise.resolve('done');
      queue.process(processor);
      const job = await queue.add({ content: 'test' });
      await new Promise(r => setTimeout(r, 50));
      expect(job.state).toBe('completed');
    });

    test('emits completed event on success', async () => {
      const completedCb = jest.fn();
      queue.on('completed', completedCb);
      const processor = (job) => Promise.resolve();
      queue.process(processor);
      await queue.add({ content: 'test' });
      await new Promise(r => setTimeout(r, 50));
      expect(completedCb).toHaveBeenCalled();
    });

    test('sets state to failed after max attempts (attempts=1)', async () => {
      const processor = (job) => Promise.reject(new Error('fail'));
      queue.process(processor);
      const job = await queue.add({ content: 'test' }, { attempts: 1 });
      await new Promise(r => setTimeout(r, 50));
      expect(job.state).toBe('failed');
      expect(job.failedReason).toBe('fail');
    });

    test('emits failed event after max attempts', async () => {
      const failedCb = jest.fn();
      queue.on('failed', failedCb);
      const processor = (job) => Promise.reject(new Error('oops'));
      queue.process(processor);
      await queue.add({ content: 'test' }, { attempts: 1 });
      await new Promise(r => setTimeout(r, 50));
      expect(failedCb).toHaveBeenCalled();
    });

    test('getJobCounts() returns counts by state', async () => {
      const processor = (job) => Promise.resolve();
      queue.process(processor);
      await queue.add({ content: 'test1' });
      await queue.add({ content: 'test2' });
      await new Promise(r => setTimeout(r, 100));
      const counts = await queue.getJobCounts();
      expect(typeof counts.waiting).toBe('number');
      expect(typeof counts.active).toBe('number');
      expect(typeof counts.completed).toBe('number');
      expect(typeof counts.failed).toBe('number');
      expect(counts.completed).toBeGreaterThanOrEqual(1);
    });

    test('getJobs() returns jobs matching specified states', async () => {
      const processor = (job) => Promise.resolve();
      queue.process(processor);
      await queue.add({ content: 'test1' });
      await new Promise(r => setTimeout(r, 50));
      const completed = await queue.getJobs(['completed']);
      expect(Array.isArray(completed)).toBe(true);
      expect(completed.length).toBeGreaterThanOrEqual(1);
    });

    test('remove() deletes job by id', async () => {
      const job = await queue.add({ content: 'test' });
      const removed = queue.remove(job.id);
      // remove returns a Promise (async) in this implementation
      expect(await removed).toBe(true);
    });

    test('remove() returns false for nonexistent job', async () => {
      const removed = await queue.remove('nonexistent-id');
      expect(removed).toBe(false);
    });

    test('close() clears jobs and processors', async () => {
      const processor = (job) => Promise.resolve();
      queue.process(processor);
      await queue.add({ content: 'test' });
      await queue.close();
      const counts = await queue.getJobCounts();
      expect(counts.waiting).toBe(0);
      expect(counts.completed).toBe(0);
      expect(queue.processors.length).toBe(0);
    });

    test('_evictCompletedJobs removes oldest when cap exceeded', async () => {
      queue._maxCompletedJobs = 2;
      const processor = (job) => Promise.resolve();
      queue.process(processor);
      await queue.add({ content: 'test1' });
      await queue.add({ content: 'test2' });
      await queue.add({ content: 'test3' });
      await queue.add({ content: 'test4' });
      await new Promise(r => setTimeout(r, 200));
      const completed = await queue.getJobs(['completed']);
      expect(completed.length).toBeLessThanOrEqual(2);
    });

    test('_calculateBackoff returns exponential delay', () => {
      const delay = queue._calculateBackoff(1, { type: 'exponential', delay: 1000 });
      expect(delay).toBe(1000); // 1000 * 2^0
      const delay2 = queue._calculateBackoff(2, { type: 'exponential', delay: 1000 });
      expect(delay2).toBe(2000); // 1000 * 2^1
    });

    test('_calculateBackoff returns fixed delay for non-exponential', () => {
      const delay = queue._calculateBackoff(5, { type: 'fixed', delay: 500 });
      expect(delay).toBe(500);
    });

    test('on() registers event listeners', () => {
      const cb = jest.fn();
      queue.on('completed', cb);
      expect(queue.eventListeners.completed).toContain(cb);
    });
  });

  describe('closeQueues()', () => {
    test('closes all queues without error', async () => {
      const queues = await initializeQueues();
      await expect(closeQueues(queues)).resolves.not.toThrow();
    });
  });
});
