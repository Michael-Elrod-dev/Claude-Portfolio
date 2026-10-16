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

/** One line per order the executor handled: what was asked and what happened. */
function orderOutcomes(execution) {
  return (execution.results || []).map((r) => ({
    action: r.recommendation?.action ?? null,
    ticker: r.recommendation?.ticker ?? null,
    amount: r.recommendation?.amount ?? null,
    status: r.status,
    orderId: r.orderId || null,
    reason: r.reason || null,
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

"executed" means the broker accepted the order, not that it has filled. On a scheduled run the orders go in before the open and fill at it.

\`\`\`json
${JSON.stringify({ summary: execution.summary, orders: orderOutcomes(execution) }, null, 2)}
\`\`\`

Produce the new memo as a single JSON object matching the schema in your instructions.`;
}

module.exports = buildMemoUpdaterUserPrompt;
