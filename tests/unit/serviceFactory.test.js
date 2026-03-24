process.env.MOCK_MODE = 'true';
process.env.NODE_ENV = 'test';

const { getService, getMode, isMockMode, clearCache, getAvailableServices, initializeAllServices } = require('../../utils/serviceFactory');

describe('serviceFactory', () => {
  beforeEach(() => {
    clearCache();
  });

  describe('getService', () => {
    test('returns Anthropic mock instance for anthropic service', () => {
      const service = getService('anthropic');
      expect(service).toBeDefined();
      expect(typeof service).toBe('object');
    });

    test('returns Gmail mock instance for gmail service', () => {
      const service = getService('gmail');
      expect(service).toBeDefined();
      expect(typeof service).toBe('object');
    });

    test('returns Drive mock instance for drive service', () => {
      const service = getService('drive');
      expect(service).toBeDefined();
      expect(typeof service).toBe('object');
    });

    test('returns Upwork mock instance for upwork service', () => {
      const service = getService('upwork');
      expect(service).toBeDefined();
      expect(typeof service).toBe('object');
    });

    test('returns Calendly mock instance for calendly service', () => {
      const service = getService('calendly');
      expect(service).toBeDefined();
      expect(typeof service).toBe('object');
    });

    test('normalizes service name to lowercase', () => {
      const serviceLower = getService('anthropic');
      const serviceUpper = getService('ANTHROPIC');
      expect(serviceLower).toBe(serviceUpper);
    });

    test('throws error for unknown service', () => {
      expect(() => getService('unknown')).toThrow(/Unknown service/);
    });

    test('caches service instances on repeated calls', () => {
      const first = getService('anthropic');
      const second = getService('anthropic');
      expect(first).toBe(second);
    });

    test('clearCache makes next getService call create new instance', () => {
      const first = getService('anthropic');
      clearCache();
      const second = getService('anthropic');
      expect(first).not.toBe(second);
    });
  });

  describe('getMode', () => {
    test('returns mock mode string', () => {
      const mode = getMode();
      expect(mode).toBe('mock');
    });
  });

  describe('isMockMode', () => {
    test('returns true when MOCK_MODE is true', () => {
      expect(isMockMode()).toBe(true);
    });
  });

  describe('getAvailableServices', () => {
    test('returns array of available service names', () => {
      const services = getAvailableServices();
      expect(Array.isArray(services)).toBe(true);
      expect(services.length).toBe(5);
    });

    test('includes all expected service names', () => {
      const services = getAvailableServices();
      expect(services).toContain('anthropic');
      expect(services).toContain('gmail');
      expect(services).toContain('drive');
      expect(services).toContain('upwork');
      expect(services).toContain('calendly');
    });
  });

  describe('initializeAllServices', () => {
    test('returns object with all five services', () => {
      const services = initializeAllServices();
      expect(services).toBeDefined();
      expect(typeof services).toBe('object');
      expect(Object.keys(services).length).toBe(5);
    });

    test('includes anthropic, gmail, drive, upwork, calendly keys', () => {
      const services = initializeAllServices();
      expect(services.anthropic).toBeDefined();
      expect(services.gmail).toBeDefined();
      expect(services.drive).toBeDefined();
      expect(services.upwork).toBeDefined();
      expect(services.calendly).toBeDefined();
    });

    test('returns cached service instances', () => {
      const first = initializeAllServices();
      const second = initializeAllServices();
      expect(first.anthropic).toBe(second.anthropic);
      expect(first.gmail).toBe(second.gmail);
      expect(first.drive).toBe(second.drive);
      expect(first.upwork).toBe(second.upwork);
      expect(first.calendly).toBe(second.calendly);
    });
  });
});
