/**
 * Quality Gates — Automated acceptance checks for generated content.
 *
 * These run before delivery to catch placeholder content,
 * missing sections, template variables, etc.
 */

const logger = require('./logger');

const PLACEHOLDER_PATTERNS = [
  /\[INSERT .+?\]/gi,
  /\{INSERT .+?\}/gi,
  /\[YOUR .+?\]/gi,
  /\[COMPANY NAME\]/gi,
  /\[CLIENT NAME\]/gi,
  /\[TODO\]/gi,
  /\[PLACEHOLDER\]/gi,
  /Lorem ipsum/gi,
  /\{\{.+?\}\}/g,           // Mustache/Handlebars templates
  /<%.+?%>/g,               // EJS templates
];

const BANNED_CLAIMS = [
  /guaranteed results/gi,
  /100% satisfaction/gi,
  /risk.?free/gi,
  /no.?obligation/gi,
];

/**
 * Run all quality gates on content before delivery.
 * Returns { passed: bool, failures: string[] }
 */
function validateContent(content, options = {}) {
  const failures = [];
  const text = typeof content === 'string' ? content : (content?.body || '');
  const title = typeof content === 'object' ? (content.title || '') : '';

  if (!text || text.trim().length === 0) {
    failures.push('Content body is empty');
    return { passed: false, failures };
  }

  // Minimum length
  const minLength = options.minLength || 100;
  if (text.length < minLength) {
    failures.push(`Content too short (${text.length} chars, min ${minLength})`);
  }

  // Check for unresolved placeholders
  for (const pattern of PLACEHOLDER_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      failures.push(`Unresolved placeholder: ${matches[0]}`);
    }
  }

  // Check title
  if (title) {
    for (const pattern of PLACEHOLDER_PATTERNS) {
      const matches = title.match(pattern);
      if (matches) {
        failures.push(`Placeholder in title: ${matches[0]}`);
      }
    }
  }

  // Check for banned claims
  if (!options.skipBannedClaims) {
    for (const pattern of BANNED_CLAIMS) {
      const matches = text.match(pattern);
      if (matches) {
        failures.push(`Banned claim detected: ${matches[0]}`);
      }
    }
  }

  // Check for required sections if specified
  if (options.requiredSections && Array.isArray(options.requiredSections)) {
    for (const section of options.requiredSections) {
      if (!text.toLowerCase().includes(section.toLowerCase())) {
        failures.push(`Missing required section: ${section}`);
      }
    }
  }

  const passed = failures.length === 0;
  if (!passed) {
    logger.warn('[qualityGates] Content failed validation', { failureCount: failures.length, failures });
  }

  return { passed, failures };
}

module.exports = { validateContent, PLACEHOLDER_PATTERNS, BANNED_CLAIMS };
