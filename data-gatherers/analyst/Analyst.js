'use strict';

const Anthropic = require('@anthropic-ai/sdk').default;
const SYSTEM_PROMPT = require('../prompts/analystSystemPrompt');
const buildUserPrompt = require('../prompts/buildAnalystUserPrompt');
const { parseRecommendations } = require('./parseResponse');

const DEFAULT_MODEL = 'claude-opus-5-5';
const DEFAULT_MAX_TOKENS = 64_000;
const DEFAULT_MAX_WEB_SEARCHES = 20;
const DEFAULT_EFFORT = 'xhigh';

/**
 * Calls the Anthropic API with the assembled briefing and returns Claude's
 * trade recommendations.
 *
 * Configuration choices baked in here (see README.md for rationale):
 *   - model: claude-opus-5-5 (the current Opus, strongest for agentic
 *     work; cheaper than Opus 5 at $4/$20 per MTok vs $5/$25)
 *   - thinking: adaptive (Opus 5.5's default when omitted; `disabled` and
 *     budget_tokens both 400 at every effort level)
 *   - effort: xhigh — and it MUST stay explicit. Opus 5.5 defaults to
 *     `medium`, a level below Opus 5's `high`, so dropping this line
 *     would quietly shallow out the reasoning rather than erroring.
 *   - web_search: 20-call budget per run. Observed usage is 10-13, so 15
 *     was closer to the ceiling than is comfortable: exhausting the
 *     budget just stops the research mid-way, with no error.
 *   - prompt cache: system prompt is wrapped as an ephemeral text block,
 *     so weekly runs only pay full price for the user prompt and tools
 *
 * max_tokens is 64k against ~20k of observed output — it is a ceiling,
 * not a spend, so the headroom is free and protects against a long run
 * truncating mid-JSON. Streaming is required at this size (>16k risks SDK
 * HTTP timeouts); we use stream() + finalMessage() rather than .create()
 * so the SDK handles long-running responses cleanly.
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
