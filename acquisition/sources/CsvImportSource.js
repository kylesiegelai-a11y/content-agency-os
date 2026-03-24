/**
 * CsvImportSource - Import leads from CSV or structured JSON
 */

const AcquisitionSource = require('../AcquisitionSource');
const { SOURCE_TYPES, createOpportunity } = require('../opportunitySchema');

class CsvImportSource extends AcquisitionSource {
  constructor(options = {}) {
    super('csv_import', SOURCE_TYPES.CSV_IMPORT, options);
  }

  /**
   * Parse CSV string with simple parsing (handles quoted fields)
   * @param {string} csvString - CSV content
   * @returns {Array<Object>} Array of row objects
   */
  _parseCsv(csvString) {
    const lines = csvString.split('\n').filter(line => line.trim());
    if (lines.length === 0) return [];

    // Parse header
    const header = this._parseCSVLine(lines[0]);
    const rows = [];

    // Parse data rows
    for (let i = 1; i < lines.length; i++) {
      const values = this._parseCSVLine(lines[i]);
      const row = {};
      header.forEach((col, idx) => {
        row[col.trim()] = values[idx] ? values[idx].trim() : '';
      });
      if (Object.values(row).some(val => val)) {
        rows.push(row);
      }
    }

    return rows;
  }

  /**
   * Parse a single CSV line handling quoted fields
   * @param {string} line - CSV line
   * @returns {Array<string>} Parsed fields
   */
  _parseCSVLine(line) {
    const fields = [];
    let current = '';
    let insideQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (insideQuotes && nextChar === '"') {
          current += '"';
          i++;
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (char === ',' && !insideQuotes) {
        fields.push(current);
        current = '';
      } else {
        current += char;
      }
    }

    fields.push(current);
    return fields;
  }

  /**
   * Import leads from CSV string
   * @param {string} csvString - CSV content
   * @returns {Object} { accepted: Array, rejected: Array, report: Object }
   */
  async importFromCsv(csvString) {
    try {
      const rows = this._parseCsv(csvString);
      return this._processRows(rows);
    } catch (error) {
      this._recordError(error);
      throw error;
    }
  }

  /**
   * Import leads from JSON array
   * @param {Array<Object>} jsonArray - Array of objects
   * @returns {Object} { accepted: Array, rejected: Array, report: Object }
   */
  async importFromJson(jsonArray) {
    try {
      if (!Array.isArray(jsonArray)) {
        throw new Error('Input must be an array of objects');
      }
      return this._processRows(jsonArray);
    } catch (error) {
      this._recordError(error);
      throw error;
    }
  }

  /**
   * Process rows and return import report
   * @param {Array<Object>} rows - Rows to process
   * @returns {Object} { accepted: Array, rejected: Array, report: Object }
   */
  _processRows(rows) {
    const accepted = [];
    const rejected = [];
    const reasons = [];

    rows.forEach((row, idx) => {
      const validation = this.validatePayload(row);
      if (validation.valid) {
        const normalized = this.normalizeOpportunity(row);
        accepted.push(normalized);
      } else {
        rejected.push({ row: idx, errors: validation.errors });
        reasons.push(`Row ${idx}: ${validation.errors.join('; ')}`);
      }
    });

    this._recordSuccess(accepted.length);

    return {
      accepted,
      rejected,
      report: {
        total: rows.length,
        accepted: accepted.length,
        rejected: rejected.length,
        reasons
      }
    };
  }

  /**
   * Validate row data
   * @param {Object} raw - Row object
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  validatePayload(raw) {
    const errors = [];

    if (!raw || typeof raw !== 'object') {
      errors.push('Row must be a non-null object');
      return { valid: false, errors };
    }

    // Map flexible column names
    const title = raw.title || raw.project_name || raw.project || '';
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      errors.push('title/project_name is required and must be non-empty');
    }

    const hasClientInfo = !!(
      raw.name ||
      raw.client_name ||
      raw.email ||
      raw.client_email ||
      raw.company ||
      raw.company_name
    );
    if (!hasClientInfo) {
      errors.push('At least one of name/client_name, email/client_email, or company/company_name is required');
    }

    const email = raw.email || raw.client_email;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push('email/client_email must be a valid email format');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Normalize row to opportunity schema with flexible column mapping
   * @param {Object} row - CSV/JSON row
   * @returns {Object} Normalized opportunity
   */
  normalizeOpportunity(row) {
    // Flexible column mapping
    const title = row.title || row.project_name || row.project || '';
    const clientName = row.name || row.client_name || '';
    const clientEmail = row.email || row.client_email || '';
    const companyName = row.company || row.company_name || '';
    const budgetMin = row.budget || row.budget_min;
    const budgetMax = row.budget_max;
    const timeline = row.timeline;
    const services = row.tags || row.services || '';

    const tags = [];
    if (services) {
      if (Array.isArray(services)) {
        tags.push(...services);
      } else if (typeof services === 'string') {
        tags.push(...services.split(/[,;]\s*/));
      }
    }

    const budgetMinNum = typeof budgetMin === 'number' ? budgetMin : (budgetMin ? parseInt(budgetMin, 10) : null);
    const budgetMaxNum = typeof budgetMax === 'number' ? budgetMax : (budgetMax ? parseInt(budgetMax, 10) : null);

    return createOpportunity({
      source_type: SOURCE_TYPES.CSV_IMPORT,
      source_name: this.name,
      source_record_id: row.id || `csv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      received_at: new Date().toISOString(),
      title,
      description: row.description || '',
      client_name: clientName,
      client_email: clientEmail,
      company_name: companyName,
      budget_min: isNaN(budgetMinNum) ? null : budgetMinNum,
      budget_max: isNaN(budgetMaxNum) ? null : budgetMaxNum,
      timeline,
      tags,
      raw_payload: row,
      confidence_score: 0.85,
      status: 'normalized',
      metadata: {
        import_source: 'csv_import',
        import_timestamp: new Date().toISOString()
      }
    });
  }
}

module.exports = CsvImportSource;
