'use strict';

// Tiny JSON-file store. Deals, buyers and settings you add are saved to
// data/store.json (git-ignored). The sample files are read-only seed data.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createStore } = require('./store-core');

const DATA_DIR = path.join(__dirname, '..', 'data');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function seed() {
  return {
    deals: readJson(path.join(DATA_DIR, 'sample-deals.json'), []).map((d) => ({ ...d, sample: true, source: 'Sample' })),
    buyers: readJson(path.join(DATA_DIR, 'sample-buyers.json'), []).map((b) => ({ ...b, sample: true })),
    settings: {},
  };
}

function fileStore(file = process.env.DEALFLIP_STORE || path.join(DATA_DIR, 'store.json')) {
  return createStore({
    load: () => readJson(file, null),
    save: (state) => fs.writeFileSync(file, JSON.stringify(state, null, 2)),
    newId: (kind) => `${kind === 'deals' ? 'd' : 'b'}${crypto.randomBytes(4).toString('hex')}`,
    seed,
  });
}

module.exports = { createStore, fileStore, seed };
