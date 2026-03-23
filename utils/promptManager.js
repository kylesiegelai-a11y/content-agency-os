/**
 * Prompt Manager
 * Loads versioned prompts from agents/prompts/ directory
 * Tracks which version each job used
 * Supports version listing and retrieval
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const PROMPTS_DIR = path.join(__dirname, '../agents/prompts');

class PromptManager {
  constructor() {
    this.promptCache = {};
    this.jobPromptVersions = {};
    this.loadAllPrompts();
  }

  /**
   * Load all prompts from the prompts directory
   * Caches them in memory for fast access
   */
  loadAllPrompts() {
    try {
      if (!fs.existsSync(PROMPTS_DIR)) {
        logger.warn(`Prompts directory not found: ${PROMPTS_DIR}`);
        return;
      }

      const files = fs.readdirSync(PROMPTS_DIR);

      for (const file of files) {
        if (file.endsWith('.txt')) {
          const filePath = path.join(PROMPTS_DIR, file);
          try {
            const content = fs.readFileSync(filePath, 'utf8');
            const promptKey = this.parsePromptKey(file);

            if (!this.promptCache[promptKey.name]) {
              this.promptCache[promptKey.name] = {};
            }

            this.promptCache[promptKey.name][promptKey.version] = {
              version: promptKey.version,
              content,
              filePath,
              loadedAt: new Date().toISOString()
            };

            logger.debug(`Loaded prompt: ${promptKey.name} v${promptKey.version}`);
          } catch (error) {
            logger.error(`Failed to load prompt file ${file}:`, error.message);
          }
        }
      }

      logger.info(`Prompt Manager initialized with ${Object.keys(this.promptCache).length} prompt types`);
    } catch (error) {
      logger.error('Error loading prompts:', error.message);
    }
  }

  /**
   * Parse prompt filename to extract name and version
   * Expected format: name_v1.0.txt
   * @param {string} filename - The filename to parse
   * @returns {Object} { name: string, version: string }
   */
  parsePromptKey(filename) {
    const match = filename.match(/^(.+?)_v([\d.]+)\.txt$/);

    if (match) {
      return {
        name: match[1],
        version: match[2]
      };
    }

    return {
      name: filename.replace(/\.txt$/, ''),
      version: '1.0'
    };
  }

  /**
   * Get a prompt by name and optional version
   * Returns latest version if no version specified
   * @param {string} promptName - Name of the prompt
   * @param {string} version - Version (optional, defaults to latest)
   * @returns {Object} { content, version, filePath } or null if not found
   */
  getPrompt(promptName, version = null) {
    const promptVersions = this.promptCache[promptName];

    if (!promptVersions) {
      logger.warn(`Prompt not found: ${promptName}`);
      return null;
    }

    // If specific version requested
    if (version && promptVersions[version]) {
      logger.info(`Retrieved prompt: ${promptName} v${version}`);
      return promptVersions[version];
    }

    // Return latest version (supports non-numeric segments like "1.0-beta")
    const versions = Object.keys(promptVersions).sort((a, b) => {
      const aParts = a.split('.');
      const bParts = b.split('.');
      for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const aNum = parseInt(aParts[i], 10);
        const bNum = parseInt(bParts[i], 10);
        // Both segments are valid numbers: compare numerically
        if (!isNaN(aNum) && !isNaN(bNum) && aNum !== bNum) return bNum - aNum;
        // Fallback to lexicographic comparison for non-numeric segments
        if (isNaN(aNum) || isNaN(bNum)) {
          const aStr = aParts[i] || '';
          const bStr = bParts[i] || '';
          if (aStr !== bStr) return bStr.localeCompare(aStr);
        }
      }
      return 0;
    });

    const latestVersion = versions[0];
    if (latestVersion) {
      logger.info(`Retrieved prompt: ${promptName} v${latestVersion} (latest)`);
      return promptVersions[latestVersion];
    }

    return null;
  }

  /**
   * Get all available versions for a prompt
   * @param {string} promptName - Name of the prompt
   * @returns {Array} Array of version strings
   */
  getVersions(promptName) {
    const promptVersions = this.promptCache[promptName];
    return promptVersions ? Object.keys(promptVersions) : [];
  }

  /**
   * List all available prompts with their versions
   * @returns {Object} Map of prompt names to version arrays
   */
  listPrompts() {
    const prompts = {};

    for (const [promptName, versions] of Object.entries(this.promptCache)) {
      prompts[promptName] = {
        versions: Object.keys(versions),
        latestVersion: this.getLatestVersion(promptName),
        count: Object.keys(versions).length
      };
    }

    return prompts;
  }

  /**
   * Get the latest version string for a prompt
   * @param {string} promptName - Name of the prompt
   * @returns {string} Latest version
   */
  getLatestVersion(promptName) {
    const versions = this.getVersions(promptName);
    if (versions.length === 0) return null;

    return versions.sort((a, b) => {
      const aParts = a.split('.');
      const bParts = b.split('.');
      for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const aNum = parseInt(aParts[i], 10);
        const bNum = parseInt(bParts[i], 10);
        if (!isNaN(aNum) && !isNaN(bNum) && aNum !== bNum) return bNum - aNum;
        if (isNaN(aNum) || isNaN(bNum)) {
          const aStr = aParts[i] || '';
          const bStr = bParts[i] || '';
          if (aStr !== bStr) return bStr.localeCompare(aStr);
        }
      }
      return 0;
    })[0];
  }

  /**
   * Track which version was used for a job
   * @param {string} jobId - Job identifier
   * @param {string} promptName - Name of the prompt
   * @param {string} version - Version of the prompt
   */
  trackJobPromptVersion(jobId, promptName, version) {
    if (!this.jobPromptVersions[jobId]) {
      this.jobPromptVersions[jobId] = {};
    }

    this.jobPromptVersions[jobId][promptName] = {
      version,
      usedAt: new Date().toISOString()
    };

    logger.debug(`Tracked: Job ${jobId} using ${promptName} v${version}`);
  }

  /**
   * Get which prompts and versions were used in a job
   * @param {string} jobId - Job identifier
   * @returns {Object} Map of prompt names to usage info
   */
  getJobPromptVersions(jobId) {
    return this.jobPromptVersions[jobId] || {};
  }

  /**
   * Reload all prompts (useful if files changed)
   */
  reload() {
    this.promptCache = {};
    this.loadAllPrompts();
    logger.info('Prompt Manager reloaded');
  }

  /**
   * Get stats about loaded prompts
   * @returns {Object} Statistics
   */
  getStats() {
    let totalPrompts = 0;
    let totalVersions = 0;

    for (const versions of Object.values(this.promptCache)) {
      totalPrompts++;
      totalVersions += Object.keys(versions).length;
    }

    return {
      promptTypes: totalPrompts,
      totalVersions,
      jobsTracked: Object.keys(this.jobPromptVersions).length,
      cacheSize: JSON.stringify(this.promptCache).length,
      cachedAt: new Date().toISOString()
    };
  }
}

let globalPromptManager = null;

/**
 * Get global instance of PromptManager
 * @returns {PromptManager} Global prompt manager instance
 */
function getPromptManager() {
  if (!globalPromptManager) {
    globalPromptManager = new PromptManager();
  }
  return globalPromptManager;
}

/**
 * Create new instance of PromptManager
 * @returns {PromptManager} New prompt manager instance
 */
function createPromptManager() {
  return new PromptManager();
}

module.exports = {
  PromptManager,
  getPromptManager,
  createPromptManager
};
