'use strict';

// Tiny JSON-file store. Deals, buyers and settings you add are saved to
// data/store.json (git-ignored). The sample files are read-only seed data.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

// The same interface is implemented in the browser preview on top of localStorage.
function createStore({ load, save, newId }) {
  let state = load() || seed();
  state.settings = state.settings || {};

  return {
    list: (kind) => state[kind],
    get: (kind, id) => state[kind].find((x) => x.id === id),
    add(kind, item) {
      const record = { ...item, id: newId(kind) };
      state[kind].push(record);
      save(state);
      return record;
    },
    addMany(kind, items) {
      const records = items.map((item) => ({ ...item, id: newId(kind) }));
      state[kind].push(...records);
      if (records.length) save(state);
      return records;
    },
    update(kind, id, patch) {
      const i = state[kind].findIndex((x) => x.id === id);
      if (i === -1) return null;
      state[kind][i] = { ...state[kind][i], ...patch, id };
      save(state);
      return state[kind][i];
    },
    remove(kind, id) {
      const before = state[kind].length;
      state[kind] = state[kind].filter((x) => x.id !== id);
      if (state[kind].length !== before) save(state);
      return state[kind].length !== before;
    },
    getSettings: () => state.settings,
    setSettings(s) {
      state.settings = s;
      save(state);
    },
  };
}

function fileStore(file = process.env.DEALFLIP_STORE || path.join(DATA_DIR, 'store.json')) {
  return createStore({
    load: () => readJson(file, null),
    save: (state) => fs.writeFileSync(file, JSON.stringify(state, null, 2)),
    newId: (kind) => `${kind === 'deals' ? 'd' : 'b'}${crypto.randomBytes(4).toString('hex')}`,
  });
}

module.exports = { createStore, fileStore, seed };
