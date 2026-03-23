/**
 * Service Factory
 * Central factory for getting Real or Mock providers based on MOCK_MODE
 * Reads MOCK_MODE at startup and exports getService(serviceName) function
 */

const MOCK_MODE = process.env.MOCK_MODE === 'true' || process.env.MOCK_MODE === '1';

// Import mock providers
const AnthropicMock = require('../mock/providers/anthropicMock');
const GmailMock = require('../mock/providers/gmailMock');
const DriveMock = require('../mock/providers/driveMock');
const UpworkMock = require('../mock/providers/upworkMock');
const CalendlyMock = require('../mock/providers/calendlyMock');

// Service instances cache
const serviceInstances = {};

/**
 * Log startup information
 */
function logStartup() {
  const mode = MOCK_MODE ? 'MOCK' : 'PRODUCTION';
  console.log(`
╔════════════════════════════════════════════════════════════╗
║        Content Agency OS - Service Factory Init             ║
╚════════════════════════════════════════════════════════════╝

Mode: ${mode}
Status: Services ready for initialization

Services available:
  - anthropic
  - gmail
  - drive
  - upwork
  - calendly

Usage: const service = getService('serviceName');
  `);
}

/**
 * Get service instance based on service name
 * Returns mock or real provider based on MOCK_MODE
 * @param {string} serviceName - Service name (anthropic, gmail, drive, upwork, calendly)
 * @param {Object} options - Optional configuration
 * @returns {Object} Service instance
 */
function getService(serviceName, options = {}) {
  const normalizedName = serviceName.toLowerCase();

  // Return cached instance if exists
  if (serviceInstances[normalizedName]) {
    return serviceInstances[normalizedName];
  }

  let service;
  let serviceType;

  if (MOCK_MODE) {
    // Initialize mock provider
    switch (normalizedName) {
      case 'anthropic':
        service = new AnthropicMock(options);
        serviceType = 'AnthropicMock';
        break;

      case 'gmail':
        service = new GmailMock(options);
        serviceType = 'GmailMock';
        break;

      case 'drive':
        service = new DriveMock(options);
        serviceType = 'DriveMock';
        break;

      case 'upwork':
        service = new UpworkMock(options);
        serviceType = 'UpworkMock';
        break;

      case 'calendly':
        service = new CalendlyMock(options);
        serviceType = 'CalendlyMock';
        break;

      default:
        throw new Error(
          `Unknown service: ${serviceName}. Available: anthropic, gmail, drive, upwork, calendly`
        );
    }

    console.log(`[ServiceFactory] Loaded ${serviceType} (MOCK MODE)`);
  } else {
    // Initialize real provider stubs
    switch (normalizedName) {
      case 'anthropic':
        service = new AnthropicRealProvider(options);
        serviceType = 'AnthropicReal';
        break;

      case 'gmail':
        service = new GmailRealProvider(options);
        serviceType = 'GmailReal';
        break;

      case 'drive':
        service = new DriveRealProvider(options);
        serviceType = 'DriveReal';
        break;

      case 'upwork':
        service = new UpworkRealProvider(options);
        serviceType = 'UpworkReal';
        break;

      case 'calendly':
        service = new CalendlyRealProvider(options);
        serviceType = 'CalendlyReal';
        break;

      default:
        throw new Error(
          `Unknown service: ${serviceName}. Available: anthropic, gmail, drive, upwork, calendly`
        );
    }

    console.log(`[ServiceFactory] Loaded ${serviceType} (PRODUCTION MODE)`);
  }

  // Cache the instance
  serviceInstances[normalizedName] = service;

  return service;
}

/**
 * Real provider stubs (TODO: Implement with actual credentials)
 */

class AnthropicRealProvider {
  constructor(options = {}) {
    this.options = options;
    // TODO: Initialize with real Anthropic API
    // TODO: Handle API_KEY credential from environment
    throw new Error(
      'AnthropicRealProvider not yet implemented. Set MOCK_MODE=true or implement real provider.'
    );
  }
}

class GmailRealProvider {
  constructor(options = {}) {
    this.options = options;
    // TODO: Initialize with real Gmail API
    // TODO: Handle OAuth2 credentials and refresh tokens
    throw new Error(
      'GmailRealProvider not yet implemented. Set MOCK_MODE=true or implement real provider.'
    );
  }
}

class DriveRealProvider {
  constructor(options = {}) {
    this.options = options;
    // TODO: Initialize with real Google Drive API
    // TODO: Handle OAuth2 credentials and refresh tokens
    throw new Error(
      'DriveRealProvider not yet implemented. Set MOCK_MODE=true or implement real provider.'
    );
  }
}

class UpworkRealProvider {
  constructor(options = {}) {
    this.options = options;
    // TODO: Initialize with real Upwork API
    // TODO: Handle OAuth credentials and API keys
    throw new Error(
      'UpworkRealProvider not yet implemented. Set MOCK_MODE=true or implement real provider.'
    );
  }
}

class CalendlyRealProvider {
  constructor(options = {}) {
    this.options = options;
    // TODO: Initialize with real Calendly API
    // TODO: Handle personal access token credential
    throw new Error(
      'CalendlyRealProvider not yet implemented. Set MOCK_MODE=true or implement real provider.'
    );
  }
}

/**
 * Get current operation mode
 * @returns {string} 'mock' or 'production'
 */
function getMode() {
  return MOCK_MODE ? 'mock' : 'production';
}

/**
 * Check if running in mock mode
 * @returns {boolean} True if MOCK_MODE enabled
 */
function isMockMode() {
  return MOCK_MODE;
}

/**
 * Clear all cached service instances
 * Useful for testing
 */
function clearCache() {
  Object.keys(serviceInstances).forEach(key => {
    delete serviceInstances[key];
  });
}

/**
 * Get all available service names
 * @returns {Array} List of service names
 */
function getAvailableServices() {
  return ['anthropic', 'gmail', 'drive', 'upwork', 'calendly'];
}

/**
 * Initialize all services at once
 * Useful for startup validation
 * @returns {Object} Map of all initialized services
 */
function initializeAllServices() {
  const services = {};
  const availableServices = getAvailableServices();

  for (const serviceName of availableServices) {
    try {
      services[serviceName] = getService(serviceName);
    } catch (error) {
      if (!MOCK_MODE) {
        // Expected error for real providers not implemented
        console.warn(`Could not initialize ${serviceName}: ${error.message}`);
      } else {
        console.error(`Error initializing ${serviceName}:`, error.message);
        throw error;
      }
    }
  }

  return services;
}

// Log startup info on module load
logStartup();

module.exports = {
  getService,
  getMode,
  isMockMode,
  clearCache,
  getAvailableServices,
  initializeAllServices
};
