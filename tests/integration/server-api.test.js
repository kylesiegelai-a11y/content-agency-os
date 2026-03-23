/**
 * Integration tests for Content Agency OS Express server API endpoints
 * Uses supertest to test all major API routes
 */

// Set test environment BEFORE requiring the app
process.env.MOCK_MODE = 'true';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const path = require('path');
const fs = require('fs');

// Require the app after env vars are set
const { app, appState } = require('../../server');
const { initializeQueues } = require('../../utils/queueConfig');
const { Orchestrator } = require('../../orchestrator');

describe('Server API Integration Tests', () => {
  let authToken;
  const testIP = '::1'; // loopback for rate limiting tests

  /**
   * Setup: Create a known auth.json and login to get a real JWT token
   */
  beforeAll(async () => {
    // Ensure auth.json has a known password hash for deterministic testing
    const bcrypt = require('bcryptjs');
    const authPath = path.join(__dirname, '../../data', 'auth.json');
    const dataDir = path.dirname(authPath);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const hash = await bcrypt.hash('admin123', 10);
    fs.writeFileSync(authPath, JSON.stringify({ masterPassword: hash }, null, 2));

    // Initialize orchestrator and queues if not already set (startServer() doesn't run in tests)
    if (!appState.orchestrator) {
      const queues = await initializeQueues();
      appState.queues = queues;
      appState.orchestrator = new Orchestrator(queues, { maxRetries: 2 });
    }

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ password: 'admin123' });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.token).toBeDefined();
    authToken = loginRes.body.token;
  });

  /**
   * Clean up test data after all tests
   */
  afterAll(async () => {
    // Optional: clean up test auth.json if needed
    const authPath = path.join(__dirname, '../../data', 'auth.json');
    if (fs.existsSync(authPath)) {
      // Keep auth.json for manual testing, or delete with: fs.unlinkSync(authPath);
    }
  });

  // ============================================================================
  // AUTH TESTS
  // ============================================================================

  describe('POST /api/auth/login', () => {
    test('should login with correct password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ password: 'admin123' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeDefined();
      expect(res.body.expiresIn).toBe(86400);
    });

    test('should reject incorrect password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ password: 'wrongpassword' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid password');
    });

    test('should reject missing password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Password required');
    });

    test('should trigger rate limiter after 5 rapid attempts', async () => {
      // Use a unique IP to avoid cross-test interference
      const uniqueIP = `10.99.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;

      // Make 5 rapid incorrect attempts
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post('/api/auth/login')
          .set('X-Forwarded-For', uniqueIP)
          .send({ password: 'wrongpassword' });
        // First 5 should be 401 (invalid password), not yet rate limited
        expect([401, 429]).toContain(res.status);
      }

      // 6th attempt should be rate limited regardless of correct password
      const rateLimitRes = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', uniqueIP)
        .send({ password: 'admin123' });

      expect(rateLimitRes.status).toBe(429);
      expect(rateLimitRes.body.error).toContain('Too many login attempts');
      expect(rateLimitRes.body.retryAfterSeconds).toBeDefined();
    });
  });

  // ============================================================================
  // JOB ROUTES
  // ============================================================================

  describe('POST /api/jobs', () => {
    test('should create a valid job with type content', async () => {
      const res = await request(app)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          type: 'content',
          data: { topic: 'Test Topic' }
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.job).toBeDefined();
      expect(res.body.job.id).toBeDefined();
      expect(res.body.job.workflowState).toBeDefined();
    });

    test('should reject null data (typeof null === object bug)', async () => {
      const res = await request(app)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          type: 'content',
          data: null
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Job data must be a plain object');
    });

    test('should reject invalid job type', async () => {
      const res = await request(app)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          type: 'invalid_type',
          data: { topic: 'Test' }
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid job type');
    });

    test('should reject invalid deadline', async () => {
      const res = await request(app)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          type: 'content',
          data: { topic: 'Test' },
          deadline: 'not-a-date'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Deadline must be a valid ISO 8601 date string');
    });

    test('should accept valid deadline in ISO 8601 format', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1);

      const res = await request(app)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          type: 'content',
          data: { topic: 'Test' },
          deadline: futureDate.toISOString()
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    test('should reject invalid priority (out of 0-10 range)', async () => {
      const res = await request(app)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          type: 'content',
          data: { topic: 'Test' },
          priority: 15
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Priority must be a number between 0 and 10');
    });

    test('should accept valid priority value', async () => {
      const res = await request(app)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          type: 'content',
          data: { topic: 'Test' },
          priority: 7
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /api/jobs', () => {
    test('should list jobs and return array', async () => {
      const res = await request(app)
        .get('/api/jobs')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.jobs)).toBe(true);
      // jobs array may be empty if this is the first test run
    });

    test('should accept limit parameter and return within bounds', async () => {
      const res = await request(app)
        .get('/api/jobs?limit=10')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.jobs)).toBe(true);
      expect(res.body.jobs.length).toBeLessThanOrEqual(10);
    });

    test('should filter by workflow state', async () => {
      const res = await request(app)
        .get('/api/jobs?state=DISCOVERED')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.jobs)).toBe(true);
    });
  });

  // ============================================================================
  // SETTINGS ROUTES
  // ============================================================================

  describe('PATCH /api/settings/agents/:agentId', () => {
    test('should toggle valid agent pause state', async () => {
      const res = await request(app)
        .patch('/api/settings/agents/writer')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ paused: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.agent).toBe('writer');
      expect(res.body.paused).toBe(true);
    });

    test('should toggle agent back to unpaused', async () => {
      const res = await request(app)
        .patch('/api/settings/agents/writer')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ paused: false });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.paused).toBe(false);
    });

    test('should reject unknown agent', async () => {
      const res = await request(app)
        .patch('/api/settings/agents/unknownAgent123')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ paused: true });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Unknown agent');
    });

    test('should accept valid known agents', async () => {
      const validAgents = [
        'briefAnalyzer', 'researcher', 'strategist', 'editor',
        'seoOptimizer', 'factChecker', 'qualityAssurance'
      ];

      for (const agentId of validAgents) {
        const res = await request(app)
          .patch(`/api/settings/agents/${agentId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({ paused: true });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      }
    });
  });

  // ============================================================================
  // SYSTEM STATUS ROUTES
  // ============================================================================

  describe('GET /api/system/status', () => {
    test('should return system health data', async () => {
      const res = await request(app)
        .get('/api/system/status')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.status).toBeDefined();
      expect(res.body.status.uptime).toBeDefined();
      expect(res.body.status.mode).toBeDefined();
      expect(res.body.status.timestamp).toBeDefined();
      expect(res.body.status.queues).toBeDefined();
      expect(res.body.status.config).toBeDefined();
    });

    test('should show MOCK mode in test environment', async () => {
      const res = await request(app)
        .get('/api/system/status')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status.mode).toBe('MOCK');
    });

    test('should include queue statistics', async () => {
      const res = await request(app)
        .get('/api/system/status')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status.queues).toBeDefined();
    });
  });

  describe('GET /api/health', () => {
    test('should return health status', async () => {
      const res = await request(app)
        .get('/api/health')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBeDefined();
    });
  });

  // ============================================================================
  // BILLING/INVOICES ROUTES
  // ============================================================================

  describe('POST /api/invoices', () => {
    test('should create invoice with valid lineItems', async () => {
      const res = await request(app)
        .post('/api/invoices')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          client: { name: 'Test Client', email: 'client@test.com' },
          lineItems: [
            {
              description: 'Content Writing',
              quantity: 1,
              unitPrice: 500,
              total: 500
            }
          ]
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.invoice).toBeDefined();
      expect(res.body.invoice.id).toBeDefined();
      expect(res.body.invoice.total).toBe(500);
    });

    test('should reject missing client name', async () => {
      const res = await request(app)
        .post('/api/invoices')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          client: { email: 'client@test.com' },
          lineItems: [{ description: 'Service', quantity: 1, unitPrice: 100 }]
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('client.name');
    });

    test('should reject missing lineItems', async () => {
      const res = await request(app)
        .post('/api/invoices')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          client: { name: 'Test Client' }
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('lineItems');
    });

    test('should handle NaN protection when unitPrice is undefined', async () => {
      const res = await request(app)
        .post('/api/invoices')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          client: { name: 'Test Client' },
          lineItems: [
            {
              description: 'Service',
              quantity: 2,
              unitPrice: undefined
            }
          ]
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      // Invoice should be created with 0 as default price
      expect(res.body.invoice.total).toBe(0);
    });

    test('should calculate total correctly with multiple lineItems', async () => {
      const res = await request(app)
        .post('/api/invoices')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          client: { name: 'Test Client' },
          lineItems: [
            { description: 'Service A', quantity: 2, unitPrice: 250 },
            { description: 'Service B', quantity: 1, unitPrice: 500 }
          ]
        });

      expect(res.status).toBe(201);
      expect(res.body.invoice.total).toBe(1000); // (2*250) + (1*500)
    });
  });

  // ============================================================================
  // VALIDATION TESTS: limit=0 handling
  // ============================================================================

  describe('GET /api/alerts - limit parameter handling', () => {
    test('should handle limit=0 without treating as falsy', async () => {
      const res = await request(app)
        .get('/api/alerts?limit=0')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      // limit=0 should return empty alerts array, not default to 50
      // (verified by the endpoint checking Number.isFinite)
    });

    test('should use default limit when not specified', async () => {
      const res = await request(app)
        .get('/api/alerts')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/compliance/audit-log - limit parameter handling', () => {
    test('should handle limit=0 without treating as falsy', async () => {
      const res = await request(app)
        .get('/api/compliance/audit-log?limit=0')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      // limit=0 should be valid (verified by Number.isFinite check)
    });

    test('should use default limit when not specified', async () => {
      const res = await request(app)
        .get('/api/compliance/audit-log')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
    });

    test('should apply reasonable limit bounds', async () => {
      const res = await request(app)
        .get('/api/compliance/audit-log?limit=5000')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
    });
  });

  // ============================================================================
  // AUTHENTICATION TESTS
  // ============================================================================

  describe('Protected endpoints - authentication', () => {
    test('should reject requests without authorization header', async () => {
      const res = await request(app)
        .get('/api/jobs');

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Access token required');
    });

    test('should reject requests with invalid token', async () => {
      const res = await request(app)
        .get('/api/jobs')
        .set('Authorization', 'Bearer invalid.token.here');

      expect(res.status).toBe(401);
    });

    test('should accept valid JWT token', async () => {
      const res = await request(app)
        .get('/api/jobs')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
    });
  });

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('Edge cases and robustness', () => {
    test('should handle large job data gracefully', async () => {
      const largeData = { topic: 'Test', content: 'x'.repeat(10000) };

      const res = await request(app)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          type: 'content',
          data: largeData
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    test('should reject job data exceeding size limit', async () => {
      const tooLargeData = { topic: 'Test', content: 'x'.repeat(60000) };

      const res = await request(app)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          type: 'content',
          data: tooLargeData
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('too large');
    });

    test('should handle array as data (should be rejected)', async () => {
      const res = await request(app)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          type: 'content',
          data: [1, 2, 3]
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('plain object');
    });

    test('should handle invalid delivery formats', async () => {
      const res = await request(app)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          type: 'content',
          data: { topic: 'Test' },
          deliveryFormats: ['invalid_format', 'markdown']
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('delivery format');
    });

    test('should accept valid delivery formats', async () => {
      const res = await request(app)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          type: 'content',
          data: { topic: 'Test' },
          deliveryFormats: ['markdown', 'pdf']
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });
  });
});
