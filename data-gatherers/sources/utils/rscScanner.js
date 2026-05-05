'use strict';

/**
 * Capitol Trades is a Next.js App Router site. All trade data is embedded
 * in the page HTML inside `self.__next_f.push([N, "..."])` script tags as
 * a JSON-encoded RSC (React Server Components) payload string.
 *
 * The trade objects are double-encoded:
 *   1. As JSON inside the RSC payload.
 *   2. The whole RSC payload is JSON-encoded as a string in the push call.
 *
 * To extract trades:
 *   1. Find each __next_f.push(...) call and grab the second array element
 *      (a JSON string, already unescaped by JSON.parse).
 *   2. Within that decoded content, find every "txType" occurrence and walk
 *      backwards to find the enclosing object's opening brace.
 *   3. Parse that object as JSON.
 *
 * This module exports two helpers used by CongressionalSource. Keeping the
 * parsing logic here means the source class itself reads as business logic.
 */

/**
 * Parse a JSON value starting at a specific offset in `text`. Returns
 * [parsedValue, endOffset]. Equivalent to Python's JSONDecoder.raw_decode.
 *
 * Walks the string tracking brace/bracket depth and string escapes, then
 * slices and JSON.parses the balanced region. Throws on unbalanced input.
 */
function readJsonAt(text, start) {
  if (text[start] !== '{' && text[start] !== '[') {
    throw new Error(`Expected '{' or '[' at offset ${start}, got ${text[start]}`);
  }
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inStr) {
      if (c === '\\') escape = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        return [JSON.parse(slice), i + 1];
      }
    }
  }
  throw new Error(`Unbalanced JSON starting at offset ${start}`);
}

/**
 * Scan a string for embedded trade objects. A trade object is identified
 * by having both "txType" and "txDate" keys.
 *
 * Because "txType" appears AFTER the nested "issuer" object, naively
 * walking back to the nearest '{' lands inside the issuer object. We try
 * each '{' in a window before "txType", nearest first, and accept the
 * first parse that yields a dict containing both expected keys.
 */
function scanForTrades(text) {
  const found = [];
  const seen = new Set();
  const window = 8192;
  const pattern = /"txType"\s*:/g;

  let match;
  while ((match = pattern.exec(text)) !== null) {
    const pos = match.index;
    const searchStart = Math.max(0, pos - window);

    const braceOffsets = [];
    for (let i = searchStart; i < pos; i++) {
      if (text[i] === '{') braceOffsets.push(i);
    }

    for (let bi = braceOffsets.length - 1; bi >= 0; bi--) {
      try {
        const [obj] = readJsonAt(text, braceOffsets[bi]);
        if (obj && typeof obj === 'object' && 'txType' in obj && 'txDate' in obj) {
          const uid = String(
            obj._txId || `${obj.txDate}-${obj.txType}-${obj._issuerId || ''}`
          );
          if (!seen.has(uid)) {
            seen.add(uid);
            found.push(obj);
          }
          break;
        }
      } catch {
        // Wrong starting brace — try the next one out.
      }
    }
  }
  return found;
}

/**
 * Pull the inner string payload out of every `__next_f.push([N, "..."])`
 * call in the HTML. Returned strings are already unescaped by JSON.parse,
 * so callers can scan them directly with scanForTrades.
 */
function extractRscStrings(html) {
  const results = [];
  const pattern = /__next_f\.push\(/g;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    let i = match.index + match[0].length;
    while (i < html.length && /\s/.test(html[i])) i++;
    if (html[i] !== '[') continue;
    try {
      const [arr] = readJsonAt(html, i);
      if (Array.isArray(arr) && arr.length >= 2 && typeof arr[1] === 'string') {
        results.push(arr[1]);
      }
    } catch {
      // Malformed push call — skip.
    }
  }
  return results;
}

module.exports = { readJsonAt, scanForTrades, extractRscStrings };
