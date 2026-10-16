'use strict';

/**
 * Refusal handling and the claude-opus-5 server-side fallback, for both
 * Claude calls.
 *
 * Nothing here touches the API: each test swaps in a fake client whose
 * beta.messages.stream() records the request and returns a canned message
 * shaped like the documented refusal/fallback responses — a refusal is an
 * HTTP 200 with stop_reason "refusal"; a fallback adds a `fallback` content
 * block and a `fallback_message` entry in usage.iterations; a mid-stream
 * fallback leaves the declined model's partial text in place before the
 * marker and the fallback model's continuation after it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Analyst = require('./Analyst');
const MemoUpdater = require('./MemoUpdater');
const { extractJsonFromMessage } = require('./parseResponse');
const { FALLBACK_BETA, FALLBACK_MODEL, RefusalError } = require('./claudeRequest');

const PRIMARY = 'claude-opus-5-5';
const RECS = { asOf: '2026-10-19', summary: 'hold', recommendations: [] };
const BRIEFING = { generatedAt: '2026-10-19T13:00:00.000Z' };

const usage = (extra = {}) => ({ input_tokens: 100, output_tokens: 50, ...extra });
const text = (t) => ({ type: 'text', text: t });
const fallbackBlock = () => ({
  type: 'fallback',
  from: { model: PRIMARY },
  to: { model: FALLBACK_MODEL },
});

function fakeClient(message) {
  const calls = [];
  return {
    calls,
    // The pipeline must use the BETA namespace: only there does `betas`
    // become the anthropic-beta header. A plain messages.stream call would
    // send the fallback without its header, which the API rejects.
    messages: {
      stream: () => {
        throw new Error('called client.messages.stream — the fallback needs client.beta.messages');
      },
    },
    beta: {
      messages: {
        stream: (req) => {
          calls.push(req);
          return { finalMessage: async () => message };
        },
      },
    },
  };
}

function analyst(message) {
  const a = new Analyst({ apiKey: 'test' });
  a.client = fakeClient(message);
  return a;
}

function memoUpdater(message) {
  const m = new MemoUpdater({ apiKey: 'test' });
  m.client = fakeClient(message);
  return m;
}

const EXECUTION = { summary: { total: 0, executed: 0, skipped: 0, failed: 0, alreadySubmitted: 0 }, results: [] };
const runMemo = (m) => m.update({ priorMemo: { watchlist: [] }, briefing: BRIEFING, recommendations: RECS, execution: EXECUTION });

// ── The request ─────────────────────────────────────────────────────────

for (const [name, build, run] of [
  ['Analyst', analyst, (x) => x.analyze(BRIEFING)],
  ['MemoUpdater', memoUpdater, runMemo],
]) {
  test(`${name} opts into the claude-opus-5 fallback with the array-form header`, async () => {
    const x = build({ model: PRIMARY, stop_reason: 'end_turn', content: [text(JSON.stringify(RECS))], usage: usage() });
    await run(x);
    const req = x.client.calls[0];
    assert.equal(req.model, PRIMARY);
    assert.deepEqual(req.betas, [FALLBACK_BETA]);
    assert.equal(FALLBACK_BETA, 'server-side-fallback-2026-06-01', 'array form must pair with the -06-01 header');
    assert.deepEqual(req.fallbacks, [{ model: 'claude-opus-5' }]);
    assert.equal(req.thinking.type, 'adaptive');
    assert.ok(req.output_config.effort, 'effort must stay explicit — Opus 5.5 defaults to medium');
  });

  test(`${name} throws a RefusalError when the whole chain declines`, async () => {
    // Mid-stream decline: a partial that LOOKS parseable must not be used.
    const x = build({
      model: FALLBACK_MODEL,
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'cyber' },
      content: [text('{"asOf": "2026-10-19", "recommendations": []}')],
      usage: usage(),
    });
    await assert.rejects(run(x), (err) => {
      assert.ok(err instanceof RefusalError);
      assert.match(err.message, /refusal/);
      assert.match(err.message, /category=cyber/);
      assert.match(err.message, /no\s+orders were placed/);
      return true;
    });
  });

  test(`${name} still throws on a refusal whose stop_details is null`, async () => {
    const x = build({ model: PRIMARY, stop_reason: 'refusal', stop_details: null, content: [], usage: usage() });
    await assert.rejects(run(x), RefusalError);
  });

  test(`${name} reports the model that actually answered after a fallback`, async () => {
    const x = build({
      model: FALLBACK_MODEL,
      stop_reason: 'end_turn',
      content: [fallbackBlock(), text(JSON.stringify(RECS))],
      usage: usage({ iterations: [{ type: 'message' }, { type: 'fallback_message' }] }),
    });
    const out = await run(x);
    assert.equal(out.meta.model, FALLBACK_MODEL);
    assert.equal(out.meta.requestedModel, PRIMARY);
    assert.equal(out.meta.fellBack, true);
  });

  test(`${name} reports no fallback on an ordinary answer`, async () => {
    const x = build({ model: PRIMARY, stop_reason: 'end_turn', content: [text(JSON.stringify(RECS))], usage: usage() });
    const out = await run(x);
    assert.equal(out.meta.model, PRIMARY);
    assert.equal(out.meta.fellBack, false);
  });
}

test('a sticky turn (served by the fallback model, no marker) still counts as a fallback', async () => {
  const x = analyst({ model: FALLBACK_MODEL, stop_reason: 'end_turn', content: [text(JSON.stringify(RECS))], usage: usage() });
  const out = await x.analyze(BRIEFING);
  assert.equal(out.meta.fellBack, true);
  assert.equal(out.meta.model, FALLBACK_MODEL);
});

// ── The parser across a fallback boundary ───────────────────────────────

test('JSON split by a mid-stream fallback is stitched back together', () => {
  const full = JSON.stringify(RECS);
  const cut = 20;
  const parsed = extractJsonFromMessage({
    content: [text(full.slice(0, cut)), fallbackBlock(), text(full.slice(cut))],
  });
  assert.deepEqual(parsed, RECS);
});

test('a pre-output fallback (marker first, no partial) parses the fallback answer', () => {
  const parsed = extractJsonFromMessage({ content: [fallbackBlock(), text(JSON.stringify(RECS))] });
  assert.deepEqual(parsed, RECS);
});

test('the fallback marker is never mistaken for an answer', () => {
  assert.throws(() => extractJsonFromMessage({ content: [fallbackBlock()] }), /No text blocks/);
});
