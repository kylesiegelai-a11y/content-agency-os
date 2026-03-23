/**
 * Mock Anthropic Provider
 * Returns realistic hardcoded JSON matching exact Claude API response structure
 * Supports async generators for streaming compatibility
 */

const MOCK_ANTHROPIC_DELAY_MS = parseInt(process.env.MOCK_ANTHROPIC_DELAY_MS || '800');

// Mock content templates per agent type
const mockContent = {
  writer: `# HR Policy Update: Remote Work Guidelines

In response to evolving workplace trends, we're implementing comprehensive remote work guidelines effective April 1st, 2024.

## Key Changes

Our organization recognizes the strategic value of flexible work arrangements. This policy establishes clear expectations while maintaining productivity and team cohesion.

## Eligibility Criteria

Remote work eligibility is determined on a per-role basis in consultation with managers. Positions requiring in-office presence include those demanding physical collaboration, customer-facing interactions, or access to specialized equipment.

## Work Schedule Requirements

Employees approved for remote work must:
- Maintain core overlap hours with their teams (typically 10am-3pm in their local timezone)
- Be available for scheduled meetings and collaboration
- Provide weekly progress updates to their managers
- Ensure adequate home office ergonomics and setup

## Technology and Equipment

The company will provide or reimburse approved equipment for approved remote workers. Standard provisions include:
- Laptop and monitor setup
- Internet stipend up to $50/month
- VPN and security software
- Collaboration tool access

## Performance Expectations

Remote work is performance-based and subject to quarterly review. Employees must demonstrate:
- Consistent meeting of project deadlines
- Quality of work equivalent to in-office standards
- Active participation in team meetings and async communication
- Professional communication practices

## Communication Protocols

Effective remote work depends on clear communication:
- Status updates via project management tools
- Weekly sync meetings with direct managers
- Daily standups for collaborative teams
- Slack/email response within 2 business hours

## Compliance and Security

Remote workers must comply with all data security policies:
- Use company VPN for all work systems
- Maintain secure home network setup
- No sharing of credentials or access
- Annual security compliance certification

## Trial and Transition

New remote work arrangements will operate on a 90-day trial basis. Both employee and manager can request adjustments based on performance and team needs.

## Additional Benefits

Approved remote workers may access:
- Home office wellness reimbursement program
- Collaboration and community events (quarterly in-person meetings)
- Mental health and work-life balance resources
- Flexible scheduling for medical appointments

Questions regarding this policy should be directed to Human Resources.`,

  proposal: `Upwork Proposal Response

Hello there!

Thank you for posting this opportunity. I'm a seasoned content strategist with 8+ years of experience creating high-performing marketing content for B2B and SaaS companies.

## Why I'm the Right Fit

Your project requires someone who understands:
- Content strategy that drives measurable results
- SEO best practices for organic visibility
- Audience research and persona development
- Multi-channel content distribution

I bring all of this and more to every project I undertake.

## My Experience

Over my career, I've:
- Developed content strategies for 50+ companies across tech, finance, and healthcare
- Increased organic traffic by an average of 180% within 6 months
- Created 1000+ pieces of high-quality content (blog posts, whitepapers, case studies)
- Worked with distributed teams and clients across 12+ time zones
- Managed budgets exceeding $500K annually

## My Process

1. **Discovery** - Understanding your business, audience, and goals
2. **Strategy** - Creating a data-informed content roadmap
3. **Creation** - Producing high-quality, on-brand content
4. **Optimization** - Testing, measuring, and refining performance
5. **Reporting** - Monthly insights and recommendations

## Portfolio Highlights

Recent successful projects include:
- A/B tested 30+ headline variations for a SaaS platform (improved CTR by 45%)
- Developed comprehensive content calendar for healthcare startup (6-month engagement)
- Created industry-specific case studies (3x improvement in qualified leads)

## My Rates

For content projects, I typically charge $60-100/hour depending on complexity, or a fixed project rate. Happy to discuss your specific budget and timeline.

I'm available to start immediately and can provide references from previous clients upon request.

Looking forward to working with you!`,

  scorer: {
    overall_quality: 8.5,
    relevance: 9.2,
    completeness: 8.1,
    accuracy: 8.7,
    clarity: 8.9,
    actionability: 7.8,
    timeliness: 8.4,
    engagement_potential: 8.6,
    seo_optimization: 7.9,
    brand_alignment: 9.0,
    comments: [
      "Strong opening with clear value proposition",
      "Good use of specific metrics and examples",
      "Could benefit from more specific call-to-action",
      "Excellent structure and readability",
      "Appropriate tone for target audience"
    ],
    recommendations: [
      "Add section on measurement/KPIs",
      "Include specific timeline deliverables",
      "Consider adding social proof elements",
      "Strengthen closing with clear next steps"
    ]
  },

  researcher: {
    key_findings: [
      "Market demand increasing 23% YoY in target demographic",
      "Competitor landscape shows 5 major players with 60% market share",
      "Customer acquisition cost trending downward across industry",
      "Emerging trends in automation and AI adoption"
    ],
    data_sources: [
      "Statista market research",
      "G2 competitive analysis",
      "SimilarWeb traffic data",
      "5 customer interviews (Q1 2024)",
      "Industry analyst reports"
    ],
    recommendations: [
      "Expand into emerging markets identified",
      "Monitor competitor pricing strategy",
      "Consider strategic partnerships",
      "Invest in automation capabilities"
    ]
  }
};

/**
 * Create a realistic Claude API response structure
 * @param {string} text - The response content
 * @param {string} model - Model name (default: claude-3-5-sonnet-20241022)
 * @param {string} stopReason - Stop reason (default: end_turn)
 * @returns {Object} Formatted response matching Anthropic API structure
 */
function createApiResponse(text, model = 'claude-3-5-sonnet-20241022', stopReason = 'end_turn') {
  // Estimate tokens (roughly 1 token per 4 characters)
  const estimatedInputTokens = 150;
  const estimatedOutputTokens = Math.ceil(text.toString().length / 4);

  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: text
      }
    ],
    model: model,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: estimatedInputTokens,
      output_tokens: estimatedOutputTokens,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0
    }
  };
}

/**
 * Get mock content based on agent type
 * @param {string} type - Agent type (writer, proposal, scorer, researcher, default)
 * @returns {string|Object} Mock content appropriate to the type
 */
function getMockContentByType(type) {
  const lowerType = (type || 'default').toLowerCase();

  switch (lowerType) {
    case 'writer':
      return mockContent.writer;
    case 'proposal':
      return mockContent.proposal;
    case 'scorer':
      return JSON.stringify(mockContent.scorer, null, 2);
    case 'researcher':
      return JSON.stringify(mockContent.researcher, null, 2);
    default:
      return mockContent.writer;
  }
}

/**
 * Simulate message streaming with configurable delay
 * Yields chunks of the response text gradually
 * @param {string} text - Text to stream
 * @param {number} delayMs - Delay between chunks in milliseconds
 */
async function* streamResponse(text, delayMs = MOCK_ANTHROPIC_DELAY_MS) {
  const chunkSize = Math.max(1, Math.floor(text.length / 10));

  for (let i = 0; i < text.length; i += chunkSize) {
    const chunk = text.substring(i, i + chunkSize);

    yield {
      type: 'content_block_delta',
      delta: {
        type: 'text_delta',
        text: chunk
      }
    };

    // Simulate realistic streaming delay
    await new Promise(resolve => setTimeout(resolve, delayMs / 10));
  }

  // Send final message delta indicating completion
  yield {
    type: 'message_delta',
    delta: {
      stop_reason: 'end_turn'
    }
  };
}

/**
 * Mock Anthropic API provider
 */
class AnthropicMock {
  constructor(options = {}) {
    this.options = options;
    this.messageCount = 0;
  }

  /**
   * Create a message using the Anthropic API format
   * @param {Object} params - Request parameters
   * @param {Array} params.messages - Message history
   * @param {string} params.model - Model to use
   * @param {number} params.max_tokens - Maximum tokens in response
   * @param {string} params.type - Agent type for content selection
   * @param {boolean} params.stream - Whether to stream response
   * @returns {Object|AsyncGenerator} Response object or async generator for streaming
   */
  async createMessage(params = {}) {
    const {
      messages = [],
      model = 'claude-3-5-sonnet-20241022',
      max_tokens = 4096,
      type = 'default',
      stream = false
    } = params;

    this.messageCount++;
    const mockText = getMockContentByType(type);

    if (stream) {
      return streamResponse(mockText, MOCK_ANTHROPIC_DELAY_MS);
    }

    return createApiResponse(mockText, model);
  }

  /**
   * Create a message with streaming (direct method)
   * @param {Object} params - Request parameters (same as createMessage)
   * @returns {AsyncGenerator} Async generator yielding stream events
   */
  async *createMessageStream(params = {}) {
    const { type = 'default' } = params;
    const mockText = getMockContentByType(type);
    yield* streamResponse(mockText, MOCK_ANTHROPIC_DELAY_MS);
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

module.exports = AnthropicMock;
