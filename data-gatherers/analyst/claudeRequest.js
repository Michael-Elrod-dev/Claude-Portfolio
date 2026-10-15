'use strict';

/**
 * Shared plumbing for the pipeline's two Claude calls (Analyst, MemoUpdater):
 * the server-side refusal fallback, and the guard that runs before any
 * response content is read.
 *
 * Why this exists: Claude Opus 5.5 runs safety classifiers that can decline a
 * request. A decline is NOT an HTTP error — it is a normal 200 with
 * `stop_reason: "refusal"` and either empty content (declined before any
 * output) or a partial answer (declined mid-stream). Equity research should
 * never trip them, but a false positive would otherwise surface as a baffling
 * "Failed to find valid JSON" from the parser and cost the run. With the
 * fallback opted in, the API re-runs the same request on [FALLBACK_MODEL]
 * inside the same call, so a decline is recovered rather than lost.
 *
 * The array form is used because the fallback target was chosen explicitly:
 * the next-newest Opus below the primary model. (The alternative,
 * `fallbacks: "default"`, lets Anthropic route by refusal category.)
 */

/**
 * Exact beta header for the ARRAY form of `fallbacks`. It is form-specific:
 * the scalar `fallbacks: "default"` form uses `server-side-fallback-2026-07-01`,
 * and pairing either header with the other form is a 400.
 */
const FALLBACK_BETA = 'server-side-fallback-2026-06-01';

/** Next-newest Opus below claude-opus-5-5. Verified as a permitted target live. */
const FALLBACK_MODEL = 'claude-opus-5';

/**
 * Add the refusal fallback to a Messages request. The request must go
 * through `client.beta.messages` so `betas` becomes the anthropic-beta header;
 * the installed SDK (0.93) does not type `fallbacks` but passes unknown body
 * keys through untouched.
 */
function withRefusalFallback(request) {
  return {
    ...request,
    betas: [FALLBACK_BETA],
    fallbacks: [{ model: FALLBACK_MODEL }],
  };
}

class RefusalError extends Error {
  constructor(message, { model, category } = {}) {
    super(message);
    this.name = 'RefusalError';
    this.model = model;
    this.category = category;
  }
}

/**
 * Throw if the whole fallback chain declined. Must run BEFORE the response
 * content is read: on a refusal the content is empty or a partial answer, and
 * a partial must be discarded rather than parsed as if it were complete.
 *
 * Branches on `stop_reason` only. `stop_details` is informational and can be
 * null even on a genuine refusal.
 */
function assertNotRefused(message, label) {
  if (message?.stop_reason !== 'refusal') return;
  const category = message.stop_details?.category ?? 'unspecified';
  throw new RefusalError(
    `${label} was declined by a safety classifier (stop_reason=refusal, ` +
      `category=${category}, model=${message.model}) and the ${FALLBACK_MODEL} ` +
      `fallback did not recover it. The run stopped before the executor, so no ` +
      `orders were placed.`,
    { model: message.model, category }
  );
}

/**
 * Which model actually produced the answer, and whether the fallback ran.
 *
 * Three signals, because each one alone misses a case:
 *   - a `fallback` content block marks a switch inside this call;
 *   - a `fallback_message` entry in `usage.iterations` is the documented
 *     served-by signal, and also covers "sticky" turns (after one fallback
 *     the API keeps serving that content from the fallback model for ~1h,
 *     with no fallback block);
 *   - top-level `model` names the producer, which also catches a sticky turn
 *     if the stream accumulator didn't carry `iterations` through.
 */
function servedBy(message, requestedModel) {
  const model = message?.model || requestedModel;
  const fellBack =
    (message?.content ?? []).some((b) => b.type === 'fallback') ||
    (message?.usage?.iterations ?? []).some((e) => e.type === 'fallback_message') ||
    model !== requestedModel;
  return { model, fellBack };
}

module.exports = {
  FALLBACK_BETA,
  FALLBACK_MODEL,
  withRefusalFallback,
  assertNotRefused,
  servedBy,
  RefusalError,
};
