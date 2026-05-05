'use strict';

/**
 * Extracts and parses the final JSON object from a Claude response.
 *
 * Why this exists: when web search (or any tool use) is enabled, the
 * response.content array can contain interleaved text, server_tool_use,
 * and tool_result blocks. The model may emit reasoning text BETWEEN
 * searches before producing its final output. Picking content[0] would
 * land on mid-conversation prose; we want the LAST text block, which is
 * the model's final answer after all tool use resolved.
 *
 * Parsing strategy (tried in order):
 *   1. A ```json...``` or ```...``` fence anywhere in the text (not just
 *      at the start — Claude sometimes puts reasoning before the fence).
 *   2. The trimmed text is itself valid JSON.
 *   3. Find the first `{` or `[` in the text and try to parse from there
 *      (handles "Here are my recommendations: { ... }" patterns).
 *   4. Walk backwards through all text blocks in case the last block is
 *      a reasoning epilogue rather than the answer.
 *
 * Generic enough to use for any "Claude returns a JSON object" prompt —
 * shared by both Analyst and MemoUpdater.
 */
function extractJsonFromMessage(message) {
  const textBlocks = message.content.filter((b) => b.type === 'text');
  if (textBlocks.length === 0) {
    throw new Error('No text blocks in Claude response');
  }

  // Walk from last to first — most of the time the answer is in the last
  // block, but we fall back through earlier blocks if needed.
  for (let i = textBlocks.length - 1; i >= 0; i--) {
    const parsed = tryParseJson(textBlocks[i].text);
    if (parsed !== null) return parsed;
  }

  const lastText = textBlocks[textBlocks.length - 1].text;
  throw new Error(
    `Failed to find valid JSON in Claude response.\n` +
      `--- Last text block (first 600 chars) ---\n${lastText.slice(0, 600)}`
  );
}

/**
 * Try every parsing strategy against a single text block.
 * Returns the parsed object/array on success, null if nothing parsed.
 */
function tryParseJson(text) {
  // ── Strategy 1: markdown fence anywhere in the text ────────────────────
  // Claude may write reasoning prose, then output ```json\n{...}\n```.
  const fenceMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      /* fall through */
    }
  }

  // ── Strategy 2: trimmed text is itself JSON ────────────────────────────
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      /* fall through */
    }
  }

  // ── Strategy 3: find the first { or [ and parse from there ────────────
  // Handles "Here are my recommendations:\n{ ... }" patterns where Claude
  // writes a sentence before the JSON object.
  const braceIdx = text.indexOf('{');
  const bracketIdx = text.indexOf('[');
  const startIdx =
    braceIdx === -1
      ? bracketIdx
      : bracketIdx === -1
        ? braceIdx
        : Math.min(braceIdx, bracketIdx);

  if (startIdx !== -1) {
    try {
      return JSON.parse(text.slice(startIdx));
    } catch {
      /* fall through — text probably has prose after the JSON */
    }
  }

  return null;
}

module.exports = {
  extractJsonFromMessage,
  // Backwards-compat alias — Analyst.js imports this name. New code should
  // use extractJsonFromMessage directly.
  parseRecommendations: extractJsonFromMessage,
};
