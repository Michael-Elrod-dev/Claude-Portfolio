'use strict';

const Anthropic = require('@anthropic-ai/sdk').default;
const SYSTEM_PROMPT = require('../prompts/analystSystemPrompt');
const buildUserPrompt = require('../prompts/buildAnalystUserPrompt');
const { parseRecommendations } = require('./parseResponse');

const DEFAULT_MODEL = 'claude-opus-4-8';
const DEFAULT_MAX_TOKENS = 32_000;
const DEFAULT_MAX_WEB_SEARCHES = 15;
const DEFAULT_EFFORT = 'xhigh';

/**
 * Calls the Anthropic API with the assembled briefing and returns Claude's
 * trade recommendations.
 *
 * Configuration choices baked in here (see README.md for rationale):
 *   - model: claude-opus-4-8 (Opus 4.8 is the most capable model for agentic work)
 *   - thinking: adaptive (the only mode 4.8 accepts; budget_tokens is
 *     removed and would 400)
 *   - effort: xhigh (recommended for coding/agentic work on 4.8)
 *   - web_search: 15-call budget per run
 *   - prompt cache: system prompt is wrapped as an ephemeral text block,
 *     so weekly runs only pay full price for the user prompt and tools
 *
 * Streaming is required because max_tokens > 16k risks SDK HTTP timeouts.
 * We use stream() + finalMessage() rather than .create() so the SDK
 * handles long-running responses cleanly.
 */
class Analyst {
  constructor({
    apiKey,
    model = DEFAULT_MODEL,
    maxTokens = DEFAULT_MAX_TOKENS,
    maxWebSearches = DEFAULT_MAX_WEB_SEARCHES,
    effort = DEFAULT_EFFORT,
  } = {}) {
    if (!apiKey) throw new Error('Analyst requires apiKey');
    this.client = new Anthropic({ apiKey });
    this.model = model;
    this.maxTokens = maxTokens;
    this.maxWebSearches = maxWebSearches;
    this.effort = effort;
  }

  async analyze(briefing) {
    const userPrompt = buildUserPrompt(briefing);

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: this.maxTokens,
      thinking: { type: 'adaptive' },
      output_config: { effort: this.effort },
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [
        {
          type: 'web_search_20260209',
          name: 'web_search',
          max_uses: this.maxWebSearches,
        },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    });

    const message = await stream.finalMessage();
    const recommendations = parseRecommendations(message);

    return {
      recommendations,
      meta: {
        model: this.model,
        stopReason: message.stop_reason,
        webSearchesUsed: message.content.filter(
          (b) => b.type === 'server_tool_use' && b.name === 'web_search'
        ).length,
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
          cacheReadTokens: message.usage.cache_read_input_tokens || 0,
          cacheCreationTokens: message.usage.cache_creation_input_tokens || 0,
        },
      },
    };
  }
}

module.exports = Analyst;
