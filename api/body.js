'use strict';

/** The request's JSON body, or null if it is missing or not JSON. */
function parseBody(event) {
  if (!event.body) return null;
  try {
    return JSON.parse(event.body);
  } catch {
    return null;
  }
}

module.exports = { parseBody };
