/**
 * Acquisition Cleanup Verification Tests
 * Proves the cleanup/hardening pass is correct:
 *   1. research.js no longer directly uses old Upwork service acquisition logic
 *   2. Production safety: no fake/sample/demo opportunities, no silent mock fallback
 *   3. Source status behavior correctly reflects disabled/unavailable/mock-only/healthy
 *   4. Marketplace source behavior is explicitly optional and honest
 *   5. Acquisition engine is the single source of truth
 */

process.env.MOCK_MODE = 'true';
process.env.NODE_ENV = 'test';

const fs = require('fs');
const path = require('path');

// ============================================================================
// 1. Legacy Path Removal — research.js no longer depends on Upwork service
// ============================================================================

describe('Legacy Path Removal', () => {
  test('agents/research.js does not import serviceFactory', () => {
    const researchSource = fs.readFileSync(
      path.join(__dirname, '../../agents/research.js'),
      'utf-8'
    );
    expect(researchSource).not.toContain("require('../utils/serviceFactory')");
    expect(researchSource).not.toContain("getService('upwork')");
    expect(researchSource).not.toContain('searchOpportunities');
  });

  test('agents/research.js documents that opportunities come from acquisition engine', () => {
    const researchSource = fs.readFileSync(
      path.join(__dirname, '../../agents/research.js'),
      'utf-8'
    );
    expect(researchSource).toContain('acquisition engine');
    expect(researchSource).not.toContain('falls back to direct service calls');
  });

  test('agents/research.js expects opportunities to be pre-provided, not fetched', () => {
    const researchSource = fs.readFileSync(
      path.join(__dirname, '../../agents/research.js'),
      'utf-8'
    );
    expect(researchSource).toContain('job.opportunities');
    // Must not have any Upwork-specific fetching
    expect(researchSource).not.toContain('upworkService');
  });
});

// ============================================================================
// 2. Production Safety
// ============================================================================

const MarketplaceSource = require('../../acquisition/sources/MarketplaceSource');
const SourceRegistry = require('../../acquisition/SourceRegistry');

// Mock marketplace service for tests
class MockMarketplaceService {
  constructor(jobs = []) {
    this.jobs = jobs;
    this._isMock = true;
  }
  async searchJobs(params) {
    return this.jobs;
  }
}

describe('Production Safety', () => {
  test('MarketplaceSource in production mode (mockMode=false) rejects mock service', async () => {
    const mockService = new MockMarketplaceService([{ id: '1', title: 'Fake' }]);
    const prodSource = new MarketplaceSource(mockService, { mockMode: false });
    await expect(prodSource.fetchOpportunities()).rejects.toThrow('production');
  });

  test('MarketplaceSource in production mode never returns fabricated data', async () => {
    const mockService = new MockMarketplaceService([]);
    const prodSource = new MarketplaceSource(mockService, { mockMode: false });
    // Should throw, not silently return empty or sample data
    await expect(prodSource.fetchOpportunities()).rejects.toThrow();
  });

  test('SourceRegistry in production mode (mockMode=false) excludes mock-only sources', () => {
    const registry = new SourceRegistry({ mockMode: false, strictProduction: true });
    const mockService = new MockMarketplaceService();
    const source = new MarketplaceSource(mockService, { mockMode: false, enabled: true });

    // Register as mock-only
    const result = registry.register(source, { mockOnly: true });
    expect(result.registered).toBe(false);
    expect(result.reason).toBe('mock_only_in_production');
  });

  test('SourceRegistry in production mode with non-strict allows mock-only registration but excludes from active', () => {
    const registry = new SourceRegistry({ mockMode: false, strictProduction: false });
    const mockService = new MockMarketplaceService();
    const source = new MarketplaceSource(mockService, { mockMode: false, enabled: true });

    const result = registry.register(source, { mockOnly: true });
    expect(result.registered).toBe(true);

    // But mock-only source is excluded from active list in production
    const active = registry.getActiveSources();
    expect(active).toEqual([]);
  });

  test('acquisition/setup.js only uses serviceFactory for upwork in mock mode', () => {
    const setupSource = fs.readFileSync(
      path.join(__dirname, '../../acquisition/setup.js'),
      'utf-8'
    );
    // The getService('upwork') call should only happen inside a MOCK_MODE guard
    expect(setupSource).toContain('MOCK_MODE && serviceFactory');
  });
});

// ============================================================================
// 3. Source Status Behavior
// ============================================================================

describe('Source Status Behavior', () => {
  test('healthy enabled source reports effectiveStatus=healthy', () => {
    const mockService = new MockMarketplaceService([]);
    const source = new MarketplaceSource(mockService, { mockMode: true, enabled: true });
    const status = source.getStatus();
    expect(status.effectiveStatus).toBe('healthy');
    expect(status.enabled).toBe(true);
    expect(status.healthy).toBe(true);
  });

  test('errored source reports effectiveStatus=unavailable', async () => {
    const badService = {
      searchJobs: async () => { throw new Error('API down'); },
      _isMock: true
    };
    const source = new MarketplaceSource(badService, { mockMode: true, enabled: true });

    try { await source.fetchOpportunities(); } catch {}

    const status = source.getStatus();
    expect(status.effectiveStatus).toBe('unavailable');
    expect(status.enabled).toBe(true);
    expect(status.healthy).toBe(false);
    expect(status.lastError).toBeDefined();
    expect(status.lastError.message).toContain('API down');
  });

  test('disabled source reports effectiveStatus=disabled', () => {
    const mockService = new MockMarketplaceService();
    const source = new MarketplaceSource(mockService, { mockMode: true, enabled: false });
    const status = source.getStatus();
    expect(status.effectiveStatus).toBe('disabled');
    expect(status.enabled).toBe(false);
  });

  test('mock-only source in production registry reports effectiveStatus=mock_only', () => {
    const registry = new SourceRegistry({ mockMode: false, strictProduction: false });
    const mockService = new MockMarketplaceService();
    const source = new MarketplaceSource(mockService, { mockMode: false, enabled: true });

    registry.register(source, { mockOnly: true });

    const statuses = registry.getSourceStatuses();
    expect(statuses.length).toBe(1);
    expect(statuses[0].effectiveStatus).toBe('mock_only');
    expect(statuses[0].activeInCurrentMode).toBe(false);
  });

  test('source status in mock mode correctly shows activeInCurrentMode=true for mock-only', () => {
    const registry = new SourceRegistry({ mockMode: true });
    const mockService = new MockMarketplaceService();
    const source = new MarketplaceSource(mockService, { mockMode: true, enabled: true });

    registry.register(source, { mockOnly: true });

    const statuses = registry.getSourceStatuses();
    expect(statuses.length).toBe(1);
    expect(statuses[0].activeInCurrentMode).toBe(true);
  });
});

// ============================================================================
// 4. Marketplace Source Explicit Optionality
// ============================================================================

describe('Marketplace Source Optionality', () => {
  test('MarketplaceSource is explicitly flagged as optional in setup', () => {
    const setupSource = fs.readFileSync(
      path.join(__dirname, '../../acquisition/setup.js'),
      'utf-8'
    );
    expect(setupSource).toContain('optional');
  });

  test('System operates normally with zero marketplace connectors', async () => {
    const AcquisitionEngine = require('../../acquisition/AcquisitionEngine');
    const FormSource = require('../../acquisition/sources/FormSource');

    // Registry with only a form source — no marketplace
    const registry = new SourceRegistry({ mockMode: false });
    const formSource = new FormSource({ enabled: true });
    registry.register(formSource);

    const engine = new AcquisitionEngine({ registry });

    formSource.submitForm({
      title: 'Test Project',
      client_name: 'Test Client',
      client_email: 'test@example.com'
    });

    const report = await engine.runAcquisitionCycle();
    expect(report.totals.fetched).toBeGreaterThanOrEqual(1);
    expect(report.errors.length).toBe(0);
  });

  test('Missing marketplace connector does not crash or fabricate data', () => {
    const registry = new SourceRegistry({ mockMode: false });
    const source = registry.getSource('upwork');
    expect(source).toBeNull(); // Not registered = not available
  });
});

// ============================================================================
// 5. Single Source of Truth
// ============================================================================

describe('Acquisition Engine is Single Source of Truth', () => {
  test('No agent module directly imports serviceFactory for acquisition purposes', () => {
    const agentsDir = path.join(__dirname, '../../agents');
    const agentFiles = fs.readdirSync(agentsDir).filter(f => f.endsWith('.js'));

    for (const file of agentFiles) {
      const content = fs.readFileSync(path.join(agentsDir, file), 'utf-8');
      // No agent should call getService('upwork') for acquisition
      const hasUpworkService = content.includes("getService('upwork')") || content.includes('getService("upwork")');
      if (hasUpworkService) {
        throw new Error(`Agent ${file} still directly references getService('upwork') — must use acquisition engine`);
      }
    }
  });

  test('serviceFactory does not list upwork in production available services', () => {
    const sfSource = fs.readFileSync(
      path.join(__dirname, '../../utils/serviceFactory.js'),
      'utf-8'
    );
    // The getAvailableServices function should conditionally include upwork only in mock mode
    expect(sfSource).toContain('if (MOCK_MODE)');
    expect(sfSource).toContain("services.push('upwork')");
  });
});
