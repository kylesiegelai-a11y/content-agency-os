const { NICHE, CONTENT_TYPE } = require('./constants');

class Validators {
  static isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  static isValidUUID(uuid) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  static validateJob(job) {
    const errors = [];
    if (!job.title || typeof job.title !== 'string' || job.title.trim().length === 0) {
      errors.push('Job title is required and must be a non-empty string');
    }
    if (!job.description || typeof job.description !== 'string' || job.description.trim().length === 0) {
      errors.push('Job description is required and must be a non-empty string');
    }
    if (job.budget !== undefined) {
      if (typeof job.budget !== 'number' || job.budget <= 0) {
        errors.push('Budget must be a positive number');
      }
    }
    if (job.niche && !Object.values(NICHE).includes(job.niche)) {
      errors.push(`Niche must be one of: ${Object.values(NICHE).join(', ')}`);
    }
    if (errors.length > 0) {
      throw new Error(JSON.stringify(errors));
    }
    return true;
  }

  static validateContent(content) {
    const errors = [];
    if (!content.title || typeof content.title !== 'string') {
      errors.push('Content title is required');
    }
    if (!content.body || typeof content.body !== 'string') {
      errors.push('Content body is required');
    }
    if (errors.length > 0) {
      throw new Error(JSON.stringify(errors));
    }
    return true;
  }

  static validateClient(client) {
    const errors = [];
    if (!client.name || typeof client.name !== 'string') {
      errors.push('Client name is required');
    }
    if (client.email && !this.isValidEmail(client.email)) {
      errors.push('Client email must be valid');
    }
    if (errors.length > 0) {
      throw new Error(JSON.stringify(errors));
    }
    return true;
  }

  static validatePagination(page, pageSize) {
    if (typeof page !== 'number' || page < 1) {
      throw new Error('Page must be a positive integer');
    }
    if (typeof pageSize !== 'number' || pageSize < 1 || pageSize > 100) {
      throw new Error('Page size must be between 1 and 100');
    }
    return true;
  }

  static validateNiche(niche) {
    if (!Object.values(NICHE).includes(niche)) {
      throw new Error(`Invalid niche: ${niche}`);
    }
    return true;
  }

  static sanitizeString(input) {
    if (typeof input !== 'string') return '';
    return input.trim().replace(/[<>]/g, '').substring(0, 10000);
  }

  static isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch (err) {
      return false;
    }
  }
}

module.exports = Validators;
