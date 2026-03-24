/**
 * Acquisition Sources Index
 * Re-exports all source implementations
 */

const FormSource = require('./FormSource');
const GmailSource = require('./GmailSource');
const CsvImportSource = require('./CsvImportSource');
const ReferralSource = require('./ReferralSource');
const MarketplaceSource = require('./MarketplaceSource');

module.exports = {
  FormSource,
  GmailSource,
  CsvImportSource,
  ReferralSource,
  MarketplaceSource
};
