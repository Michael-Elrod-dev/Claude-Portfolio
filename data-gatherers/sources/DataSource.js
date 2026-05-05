'use strict';

/**
 * Base class for all data sources that feed into the weekly briefing.
 *
 * Every source has the same contract: configure it in the constructor,
 * then call fetch() to get a structured JSON snapshot. Subclasses must
 * implement fetch(); the briefing assembler treats them all uniformly.
 */
class DataSource {
  constructor({ name }) {
    if (!name) throw new Error('DataSource requires a name');
    this.name = name;
  }

  async fetch() {
    throw new Error(`${this.name}.fetch() not implemented`);
  }
}

module.exports = DataSource;
