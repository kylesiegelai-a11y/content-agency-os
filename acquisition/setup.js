/**
 * Acquisition Engine Setup
 * Initializes the acquisition engine with configured sources based on environment.
 * Called during server startup.
 */

const logger = require('../utils/logger');
const SourceRegistry = require('./SourceRegistry');
const AcquisitionEngine = require('./AcquisitionEngine');
const { FormSource, GmailSource, CsvImportSource, ReferralSource, MarketplaceSource } = require('./sources');

const MOCK_MODE = process.env.MOCK_MODE === 'true' || process.env.MOCK_MODE === '1';

// Source enablement config (all default to true)
const SOURCE_CONFIG = {
  form: process.env.ENABLE_ACQUISITION_FORM_SOURCE !== 'false',
  gmail: process.env.ENABLE_ACQUISITION_GMAIL_SOURCE !== 'false',
  csvImport: process.env.ENABLE_ACQUISITION_IMPORT_SOURCE !== 'false',
  referral: process.env.ENABLE_ACQUISITION_REFERRAL_SOURCE !== 'false',
  marketplace: process.env.ENABLE_ACQUISITION_UPWORK_SOURCE !== 'false'
};

/**
 * Initialize the full acquisition engine with all configured sources
 * @param {Object} options
 * @param {Object} options.storage - Storage instance
 * @param {Object} options.serviceFactory - Service factory for getting providers
 * @param {Object} options.scoringConfig - Optional scoring configuration overrides
 * @returns {Object} { engine, registry }
 */
function initializeAcquisition(options = {}) {
  const { storage, serviceFactory, scoringConfig } = options;

  logger.info('[Acquisition] Initializing acquisition engine...');

  const registry = new SourceRegistry({
    mockMode: MOCK_MODE,
    strictProduction: process.env.ACQUISITION_STRICT_PRODUCTION !== 'false'
  });

  // 1. Form/webhook source
  if (SOURCE_CONFIG.form) {
    const formSource = new FormSource({ enabled: true });
    registry.register(formSource);
    logger.info('[Acquisition] Form source enabled');
  }

  // 2. Gmail source
  if (SOURCE_CONFIG.gmail) {
    try {
      const gmailService = serviceFactory ? serviceFactory.getService('gmail') : null;
      if (gmailService) {
        const gmailSource = new GmailSource(gmailService, { enabled: true });
        registry.register(gmailSource);
        logger.info('[Acquisition] Gmail source enabled');
      } else {
        logger.warn('[Acquisition] Gmail source skipped: no gmail service available');
      }
    } catch (err) {
      logger.warn(`[Acquisition] Gmail source skipped: ${err.message}`);
    }
  }

  // 3. CSV/JSON import source
  if (SOURCE_CONFIG.csvImport) {
    const csvSource = new CsvImportSource({ enabled: true });
    registry.register(csvSource);
    logger.info('[Acquisition] CSV import source enabled');
  }

  // 4. Referral source
  if (SOURCE_CONFIG.referral) {
    const referralSource = new ReferralSource({ enabled: true });
    registry.register(referralSource);
    logger.info('[Acquisition] Referral source enabled');
  }

  // 5. Marketplace source (optional, requires explicit connector)
  //    In production, a real marketplace connector must be provided via options.marketplaceService.
  //    In mock mode, the UpworkMock from serviceFactory is used for development/testing only.
  if (SOURCE_CONFIG.marketplace) {
    try {
      let marketplaceService = options.marketplaceService || null;

      // In mock mode only, fall back to the serviceFactory UpworkMock for dev/test
      if (!marketplaceService && MOCK_MODE && serviceFactory) {
        try {
          marketplaceService = serviceFactory.getService('upwork');
        } catch (e) {
          logger.warn(`[Acquisition] Marketplace mock fallback failed: ${e.message}`);
        }
      }

      if (marketplaceService) {
        const marketplaceSource = new MarketplaceSource(marketplaceService, {
          enabled: true,
          mockMode: MOCK_MODE
        });
        // Always register as mockOnly when using mock service so it's blocked in production
        const isMock = MOCK_MODE || !!(marketplaceService.constructor && marketplaceService.constructor.name.toLowerCase().includes('mock'));
        registry.register(marketplaceSource, { mockOnly: isMock });
        logger.info(`[Acquisition] Marketplace source enabled (mockMode=${MOCK_MODE}, mockOnly=${isMock})`);
      } else {
        if (!MOCK_MODE) {
          logger.info('[Acquisition] Marketplace source not configured: no real marketplace connector provided. This is expected if marketplace acquisition is not enabled.');
        } else {
          logger.warn('[Acquisition] Marketplace source skipped: no marketplace service available');
        }
      }
    } catch (err) {
      logger.warn(`[Acquisition] Marketplace source skipped: ${err.message}`);
    }
  }

  // Create engine
  const engine = new AcquisitionEngine({
    registry,
    storage,
    scoringConfig: scoringConfig || {},
    dedupeOptions: { similarityThreshold: 0.8 }
  });

  const statuses = registry.getSourceStatuses();
  const activeCount = statuses.filter(s => s.activeInCurrentMode).length;
  logger.info(`[Acquisition] Engine ready: ${activeCount} active sources, ${statuses.length} total registered`);

  return { engine, registry };
}

module.exports = { initializeAcquisition, SOURCE_CONFIG };
