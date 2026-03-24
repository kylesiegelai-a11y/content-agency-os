/**
 * Acquisition Module - Main Entry Point
 */

const AcquisitionEngine = require('./AcquisitionEngine');
const AcquisitionSource = require('./AcquisitionSource');
const SourceRegistry = require('./SourceRegistry');
const { OPPORTUNITY_STATUSES, SOURCE_TYPES, createOpportunity, validateOpportunity } = require('./opportunitySchema');
const { scoreOpportunity, qualifyOpportunities, DEFAULT_CONFIG } = require('./scoring');
const { generateDedupeKey, computeSimilarity, dedupeOpportunities } = require('./dedupe');
const { createAcquisitionRouter } = require('./acquisitionRoutes');
const { initializeAcquisition, SOURCE_CONFIG } = require('./setup');
const sources = require('./sources');

module.exports = {
  // Core classes
  AcquisitionEngine,
  AcquisitionSource,
  SourceRegistry,

  // Schema
  OPPORTUNITY_STATUSES,
  SOURCE_TYPES,
  createOpportunity,
  validateOpportunity,

  // Scoring
  scoreOpportunity,
  qualifyOpportunities,
  DEFAULT_CONFIG,

  // Dedupe
  generateDedupeKey,
  computeSimilarity,
  dedupeOpportunities,

  // Routes
  createAcquisitionRouter,

  // Setup
  initializeAcquisition,
  SOURCE_CONFIG,

  // Sources
  sources
};
