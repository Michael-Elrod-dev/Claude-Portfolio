'use strict';

/**
 * Renders the assembled briefing into the per-run user prompt.
 *
 * The user prompt is intentionally minimal — almost all of the structure
 * (rules, process, output schema) lives in the cached system prompt. The
 * user prompt is the volatile per-run payload, so it sits AFTER the cache
 * boundary and changes weekly without invalidating the prefix.
 */
function buildUserPrompt(briefing) {
  const isoDate = (briefing.generatedAt || new Date().toISOString()).slice(0, 10);

  // Human-readable date so Claude can reason about "this week", upcoming
  // market events, earnings windows, etc. without ambiguity.
  const humanDate = new Date(isoDate + 'T12:00:00Z').toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

  const briefingJson = JSON.stringify(briefing, null, 2);

  return `Today is ${humanDate} (${isoDate}). This is your weekly briefing.

\`\`\`json
${briefingJson}
\`\`\`

Analyze this briefing, conduct any research you need via web search, and provide your trade recommendations in the JSON format specified in your instructions.`;
}

module.exports = buildUserPrompt;
