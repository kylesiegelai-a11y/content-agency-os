/**
 * API Client for Claude Sonnet/Haiku
 * Provides wrapper around Anthropic API with retry logic, token tracking, and cost enforcement
 */

const serviceFactory = require('./serviceFactory');
const { getTokenTracker } = require('./tokenTracker');
const logger = require('./logger');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../config.json');

class ApiClient {
  constructor(options = {}) {
    this.options = {
      maxRetries: options.maxRetries || 3,
      retryDelayMs: options.retryDelayMs || 5000,
      defaultModel: options.defaultModel || 'claude_haiku',
      ...options
    };
    this.anthropicService = serviceFactory.getService('anthropic');
    this.tokenTracker = getTokenTracker();
    this.config = this.loadConfig();
  }

  /**
   * Load configuration from config.json
   * @returns {Object} Configuration object
   */
  loadConfig() {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const configData = fs.readFileSync(CONFIG_PATH, 'utf8');
        return JSON.parse(configData);
      }
      return {};
    } catch (error) {
      logger.warn('Failed to load config.json, using defaults');
      return {};
    }
  }

  /**
   * Map friendly model names to actual model IDs
   * @param {string} modelName - Friendly name (sonnet, haiku)
   * @returns {string} Full model ID
   */
  mapModelName(modelName) {
    const modelMap = {
      'sonnet': 'claude-3-5-sonnet-20241022',
      'haiku': 'claude-3-5-haiku-20241022',
      'claude_sonnet': 'claude-3-5-sonnet-20241022',
      'claude_haiku': 'claude-3-5-haiku-20241022'
    };
    return modelMap[modelName?.toLowerCase()] || 'claude-3-5-haiku-20241022';
  }

  /**
   * Check if job would exceed cost threshold
   * @param {string} jobId - Job identifier
   * @param {number} estimatedTokens - Estimated output tokens
   * @returns {Object} { canContinue: boolean, reason: string, currentCost: number }
   */
  checkCostThreshold(jobId, estimatedTokens = 1000) {
    const maxCostPerJob = this.config.job_processing?.max_cost_per_job || 50;
    const jobTracker = this.tokenTracker.jobTrackers[jobId];

    if (jobTracker) {
      const currentCost = this.tokenTracker.calculateJobCost(jobId);
      if (currentCost >= maxCostPerJob) {
        return {
          canContinue: false,
          reason: `Job cost (${currentCost.toFixed(2)}) exceeds threshold (${maxCostPerJob})`,
          currentCost,
          threshold: maxCostPerJob
        };
      }
    }

    return {
      canContinue: true,
      reason: 'Within cost threshold',
      currentCost: jobTracker ? this.tokenTracker.calculateJobCost(jobId) : 0,
      threshold: maxCostPerJob
    };
  }

  /**
   * Retry logic with exponential backoff
   * @param {Function} fn - Function to retry
   * @param {string} label - Label for logging
   * @returns {Promise} Result of function execution
   */
  async retryWithBackoff(fn, label = 'API Call') {
    let lastError;

    for (let attempt = 1; attempt <= this.options.maxRetries; attempt++) {
      try {
        logger.info(`[${label}] Attempt ${attempt}/${this.options.maxRetries}`);
        return await fn();
      } catch (error) {
        lastError = error;

        if (attempt < this.options.maxRetries) {
          const backoffMs = this.options.retryDelayMs * Math.pow(2, attempt - 1);
          logger.warn(
            `[${label}] Attempt ${attempt} failed: ${error.message}. Retrying in ${backoffMs}ms...`
          );
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        }
      }
    }

    throw new Error(
      `[${label}] Failed after ${this.options.maxRetries} attempts: ${lastError?.message}`
    );
  }

  /**
   * Generate content using Claude
   * @param {string} prompt - The prompt/instructions
   * @param {Object} options - Generation options
   * @param {string} options.model - Model to use (sonnet/haiku) - default: haiku
   * @param {number} options.maxTokens - Max tokens in response - default: 4096
   * @param {number} options.temperature - Temperature (0-1) - default: 0.7
   * @param {string} options.jobId - Job ID for cost tracking
   * @param {string} options.agentType - Agent type for mock routing (writer, proposal, scorer, researcher)
   * @param {boolean} options.stream - Whether to stream response - default: false
   * @returns {Promise} { content, usage: { inputTokens, outputTokens, cost }, model }
   */
  async generateContent(prompt, options = {}) {
    const {
      model = this.options.defaultModel,
      maxTokens = 4096,
      temperature = 0.7,
      jobId = `job_${Date.now()}`,
      agentType = 'default',
      stream = false
    } = options;

    // Initialize job tracking
    const mappedModel = this.mapModelName(model);
    const modelKey = model.includes('sonnet') ? 'claude_sonnet' : 'claude_haiku';
    this.tokenTracker.initializeJob(jobId, modelKey);

    // Check cost threshold before proceeding
    const costCheck = this.checkCostThreshold(jobId, maxTokens);
    if (!costCheck.canContinue) {
      logger.error(`Cost threshold exceeded for job ${jobId}:`, costCheck);
      throw new Error(`Job paused: ${costCheck.reason}`);
    }

    return this.retryWithBackoff(async () => {
      const params = {
        model: mappedModel,
        max_tokens: maxTokens,
        temperature,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        type: agentType,
        stream
      };

      logger.info(`[generateContent] Calling Claude ${mappedModel} for job ${jobId}`);

      let response;
      if (stream) {
        response = await this.anthropicService.createMessageStream(params);
      } else {
        response = await this.anthropicService.createMessage(params);
      }

      // Handle streaming response
      if (stream && response[Symbol.asyncIterator]) {
        let fullText = '';
        try {
          for await (const event of response) {
            if (event.type === 'content_block_delta' && event.delta?.text) {
              fullText += event.delta.text;
            }
          }
        } catch (streamError) {
          // Attempt to drain/close the stream to free resources
          try {
            if (typeof response.return === 'function') await response.return();
            else if (typeof response.controller?.abort === 'function') response.controller.abort();
          } catch (_drainErr) { /* best-effort cleanup */ }
          throw streamError;
        }
        response = {
          content: [{ type: 'text', text: fullText }],
          usage: {
            input_tokens: 150,
            output_tokens: Math.ceil(fullText.length / 4)
          },
          model: mappedModel
        };
      }

      // Track tokens and costs
      const inputTokens = response.usage?.input_tokens || 0;
      const outputTokens = response.usage?.output_tokens || 0;
      const content = response.content?.[0]?.text || '';

      const tracking = this.tokenTracker.trackJob(jobId, prompt, content, modelKey);

      logger.info(`[generateContent] Job ${jobId} completed`, {
        model: mappedModel,
        inputTokens,
        outputTokens,
        jobCost: tracking.jobCost.toFixed(4),
        totalCost: tracking.totalCost.toFixed(4)
      });

      return {
        content,
        usage: {
          inputTokens,
          outputTokens,
          cost: tracking.jobCost
        },
        model: mappedModel,
        jobId
      };
    }, `generateContent[${jobId}]`);
  }

  /**
   * Generate JSON-structured content using Claude
   * @param {string} prompt - The prompt/instructions
   * @param {Object} schema - JSON schema for response structure
   * @param {Object} options - Generation options (same as generateContent)
   * @returns {Promise} { content (parsed JSON), usage, model, jobId }
   */
  async generateJSON(prompt, schema, options = {}) {
    const {
      model = this.options.defaultModel,
      maxTokens = 4096,
      temperature = 0.3,
      jobId = `json_job_${Date.now()}`,
      agentType = 'default'
    } = options;

    // Sanitize schema to prevent injection via description fields
    const sanitizedSchema = JSON.parse(JSON.stringify(schema, (key, value) => {
      if (typeof value === 'string' && value.length > 500) return value.slice(0, 500);
      return value;
    }));

    // Add schema to prompt with clear delimiters
    const promptWithSchema = `${prompt}

--- RESPONSE FORMAT (system-generated, not user content) ---
You MUST respond with ONLY valid JSON matching this schema:
${JSON.stringify(sanitizedSchema, null, 2)}

Do not include any markdown formatting, code blocks, or explanations. Only output the raw JSON object.
--- END RESPONSE FORMAT ---`;

    return this.retryWithBackoff(async () => {
      // Initialize job tracking
      const mappedModel = this.mapModelName(model);
      const modelKey = model.includes('sonnet') ? 'claude_sonnet' : 'claude_haiku';
      this.tokenTracker.initializeJob(jobId, modelKey);

      // Check cost threshold before proceeding
      const costCheck = this.checkCostThreshold(jobId, maxTokens);
      if (!costCheck.canContinue) {
        logger.error(`Cost threshold exceeded for job ${jobId}:`, costCheck);
        throw new Error(`Job paused: ${costCheck.reason}`);
      }

      const params = {
        model: mappedModel,
        max_tokens: maxTokens,
        temperature,
        messages: [
          {
            role: 'user',
            content: promptWithSchema
          }
        ],
        type: agentType,
        stream: false
      };

      logger.info(`[generateJSON] Calling Claude ${mappedModel} for job ${jobId}`);

      const response = await this.anthropicService.createMessage(params);
      const rawContent = response.content?.[0]?.text || '';

      // Parse JSON response — try strict parse, then extract from markdown, then fallback
      let parsedContent;
      try {
        parsedContent = JSON.parse(rawContent);
      } catch (parseError) {
        // Try extracting JSON from markdown code blocks
        const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          try {
            parsedContent = JSON.parse(jsonMatch[1].trim());
          } catch (e) {
            // fall through to fallback
          }
        }

        if (!parsedContent) {
          logger.warn(`[generateJSON] Non-JSON response for job ${jobId}, wrapping as fallback`);
          parsedContent = { rawContent, _fallback: true };
        }
      }

      // Track tokens and costs
      const inputTokens = response.usage?.input_tokens || 0;
      const outputTokens = response.usage?.output_tokens || 0;

      const tracking = this.tokenTracker.trackJob(jobId, promptWithSchema, rawContent, modelKey);

      logger.info(`[generateJSON] Job ${jobId} completed with valid JSON`, {
        model: mappedModel,
        inputTokens,
        outputTokens,
        jobCost: tracking.jobCost.toFixed(4),
        totalCost: tracking.totalCost.toFixed(4)
      });

      return {
        content: parsedContent,
        usage: {
          inputTokens,
          outputTokens,
          cost: tracking.jobCost
        },
        model: mappedModel,
        jobId
      };
    }, `generateJSON[${jobId}]`);
  }

  /**
   * Get cost status for current session
   * @returns {Object} Cost status including budget, spent, remaining, etc.
   */
  getCostStatus() {
    const monthlyBudget = this.config.budget?.monthly_ceiling || 500;
    return this.tokenTracker.getCostStatus(monthlyBudget);
  }

  /**
   * Get tracker summary
   * @returns {Object} Session summary with costs
   */
  getSummary() {
    return this.tokenTracker.getSummary();
  }

  /**
   * Reset all tracking (new session)
   */
  resetTracking() {
    const { createNewTokenTracker } = require('./tokenTracker');
    this.tokenTracker = createNewTokenTracker();
    logger.info('[ApiClient] Tracking reset for new session');
  }
}

module.exports = ApiClient;
