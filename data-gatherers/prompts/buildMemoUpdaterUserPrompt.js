'use strict';

/**
 * Renders the per-run user prompt for the MemoUpdater.
 *
 * The MemoUpdater needs four pieces of context:
 *   - the prior memo (so it can preserve continuity)
 *   - the briefing (for portfolio state and broader context)
 *   - this run's recommendations (the decisions)
 *   - what the executor did with each one (submitted, rejected or skipped)
 *
 * Volatile content sits in the user prompt so the cached system prompt
 * stays valid from run to run.
 */

/**
 * One entry per order the executor handled: what was asked and everything
 * it learned (status, reason, final sizing, scaling, fill). Copied whole,
 * not field by field, so a new executor field reaches the memo too.
 */
function orderOutcomes(execution) {
  return (execution.results || []).map(({ recommendation, ...outcome }) => ({
    action: recommendation?.action ?? null,
    ticker: recommendation?.ticker ?? null,
    amount: recommendation?.amount ?? null,
    ...outcome,
  }));
}

function buildMemoUpdaterUserPrompt({ priorMemo, briefing, recommendations, execution }) {
  const date = (briefing.generatedAt || new Date().toISOString()).slice(0, 10);

  return `Update the memo for the run dated ${date}.

# Prior memo

\`\`\`json
${JSON.stringify(priorMemo, null, 2)}
\`\`\`

# This run's briefing

\`\`\`json
${JSON.stringify(briefing, null, 2)}
\`\`\`

# This run's recommendations

\`\`\`json
${JSON.stringify(recommendations, null, 2)}
\`\`\`

# What the executor did

"executed" means the broker accepted the order; "fill" says whether and at what price it filled. "scaled" means a buy was shrunk to fit the cash actually available after this run's sells. "notices" explain anything unusual about the execution.

\`\`\`json
${JSON.stringify({ summary: execution.summary, notices: execution.notices || [], timeline: execution.timeline || null, orders: orderOutcomes(execution) }, null, 2)}
\`\`\`

Produce the new memo as a single JSON object matching the schema in your instructions.`;
}

module.exports = buildMemoUpdaterUserPrompt;
