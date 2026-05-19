'use strict';

const Anthropic = require('@anthropic-ai/sdk').default;
const SYSTEM_PROMPT = require('../prompts/memoUpdaterSystemPrompt');
const buildUserPrompt = require('../prompts/buildMemoUpdaterUserPrompt');
const { extractJsonFromMessage } = require('./parseResponse');

const DEFAULT_MODEL = 'claude-opus-4-7';
const DEFAULT_MAX_TOKENS = 16_000;
const DEFAULT_EFFORT = 'high';

/**
 * Second Claude call in the weekly pipeline. Takes the prior memo, this
 * week's briefing, and this week's recommendations, and produces the new
 * memo.
 *
 * Differences from Analyst:
 *   - No web search tool. Memo updates are a pure transformation over
 *     known inputs; the model has no need to fetch external context.
 *   - Lower max_tokens (8k). The output is a structured memo, not a
 *     research report. Memo size is bounded by the schema.
 *   - effort: "high" rather than "xhigh". This is a bookkeeping task,
 *     not deep agentic reasoning — high is the better cost/quality
 *     balance here.
 *
 * Same shape otherwise: streaming + finalMessage(), system prompt cached
 * as an ephemeral block, JSON extraction from the last text block.
 */
class MemoUpdater {
  constructor({
    apiKey,
    model = DEFAULT_MODEL,
    maxTokens = DEFAULT_MAX_TOKENS,
    effort = DEFAULT_EFFORT,
  } = {}) {
    if (!apiKey) throw new Error('MemoUpdater requires apiKey');
    this.client = new Anthropic({ apiKey });
    this.model = model;
    this.maxTokens = maxTokens;
    this.effort = effort;
  }

  async update({ priorMemo, briefing, recommendations }) {
    if (!priorMemo) throw new Error('priorMemo is required');
    if (!briefing) throw new Error('briefing is required');
    if (!recommendations) throw new Error('recommendations is required');

    const userPrompt = buildUserPrompt({ priorMemo, briefing, recommendations });

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
      messages: [{ role: 'user', content: userPrompt }],
    });

    const message = await stream.finalMessage();
    if (message.stop_reason === 'max_tokens') {
      throw new Error(
        `MemoUpdater hit max_tokens cap (${this.maxTokens}) — response was truncated. ` +
          `Raise DEFAULT_MAX_TOKENS in MemoUpdater.js.`
      );
    }
    const newMemo = extractJsonFromMessage(message);

    return {
      memo: newMemo,
      meta: {
        model: this.model,
        stopReason: message.stop_reason,
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

module.exports = MemoUpdater;
