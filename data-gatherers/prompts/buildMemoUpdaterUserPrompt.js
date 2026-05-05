'use strict';

/**
 * Renders the per-run user prompt for the MemoUpdater.
 *
 * The MemoUpdater needs three pieces of context:
 *   - the prior memo (so it can preserve continuity)
 *   - the briefing (for portfolio state and broader context)
 *   - this week's recommendations (the decisions to reflect in the memo)
 *
 * Volatile content sits in the user prompt so the cached system prompt
 * stays valid week to week.
 */
function buildMemoUpdaterUserPrompt({ priorMemo, briefing, recommendations }) {
  const date = (briefing.generatedAt || new Date().toISOString()).slice(0, 10);

  return `Update the memo for the run dated ${date}.

# Prior memo

\`\`\`json
${JSON.stringify(priorMemo, null, 2)}
\`\`\`

# This week's briefing

\`\`\`json
${JSON.stringify(briefing, null, 2)}
\`\`\`

# This week's recommendations

\`\`\`json
${JSON.stringify(recommendations, null, 2)}
\`\`\`

Produce the new memo as a single JSON object matching the schema in your instructions.`;
}

module.exports = buildMemoUpdaterUserPrompt;
