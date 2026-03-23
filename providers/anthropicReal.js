/**
 * Real Anthropic Provider
 * Wraps the official @anthropic-ai/sdk to match the mock provider interface
 * Methods: createMessage(params), createMessageStream(params)
 */

const Anthropic = require('@anthropic-ai/sdk');

class AnthropicRealProvider {
  constructor(options = {}) {
    const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY is required. Set it in your .env file or pass apiKey in options.'
      );
    }

    this.client = new Anthropic({ apiKey });
    this.messageCount = 0;

    // Store only non-sensitive options (strip API key)
    const { apiKey: _ak, ...safeOptions } = options;
    this._safeOptions = safeOptions;
  }

  /**
   * Prevent credentials from leaking into logs/serialization
   */
  toJSON() {
    return {
      type: 'AnthropicRealProvider',
      messageCount: this.messageCount
    };
  }

  /**
   * Create a message using the Anthropic API
   * @param {Object} params - Request parameters
   * @param {Array} params.messages - Message history [{role, content}]
   * @param {string} params.model - Model to use (e.g. claude-3-5-sonnet-20241022)
   * @param {number} params.max_tokens - Maximum tokens in response
   * @param {number} params.temperature - Temperature (0-1)
   * @param {string} params.type - Agent type (ignored in real provider, used by mock)
   * @param {boolean} params.stream - Whether to stream (ignored here, use createMessageStream)
   * @returns {Object} Anthropic API response
   */
  async createMessage(params = {}) {
    const {
      messages = [],
      model = 'claude-3-5-sonnet-20241022',
      max_tokens = 4096,
      temperature = 0.7
    } = params;

    this.messageCount++;

    const response = await this.client.messages.create({
      model,
      max_tokens,
      temperature,
      messages
    });

    return response;
  }

  /**
   * Create a message with streaming
   * Returns an async generator that yields stream events matching mock format
   * @param {Object} params - Request parameters (same as createMessage)
   * @returns {AsyncGenerator} Async generator yielding stream events
   */
  async *createMessageStream(params = {}) {
    const {
      messages = [],
      model = 'claude-3-5-sonnet-20241022',
      max_tokens = 4096,
      temperature = 0.7
    } = params;

    this.messageCount++;

    const stream = this.client.messages.stream({
      model,
      max_tokens,
      temperature,
      messages
    });

    for await (const event of stream) {
      // Normalize to the event format the apiClient expects
      if (event.type === 'content_block_delta') {
        yield {
          type: 'content_block_delta',
          delta: { text: event.delta?.text || '' }
        };
      } else {
        yield event;
      }
    }
  }

  /**
   * Get message count (for testing/debugging)
   * @returns {number} Total messages processed
   */
  getMessageCount() {
    return this.messageCount;
  }

  /**
   * Reset message counter
   */
  resetMessageCount() {
    this.messageCount = 0;
  }
}

module.exports = AnthropicRealProvider;
