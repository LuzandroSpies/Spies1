'use strict';

// Tiny JSON-file store. Deals and buyers you add are saved to data/store.json
// (git-ignored). The sample files are read-only seed data.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_FILE = process.env.DEALFLIP_STORE || path.join(DATA_DIR, 'store.json');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function load() {
  const saved = readJson(STORE_FILE, null);
  if (saved) return saved;
  return {
    deals: readJson(path.join(DATA_DIR, 'sample-deals.json'), []).map((d) => ({ ...d, sample: true })),
    buyers: readJson(path.join(DATA_DIR, 'sample-buyers.json'), []).map((b) => ({ ...b, sample: true })),
  };
}

let state = load();

function save() {
  fs.writeFileSync(STORE_FILE, JSON.stringify(state, null, 2));
}

function list(kind) {
  return state[kind];
}

function get(kind, id) {
  return state[kind].find((x) => x.id === id);
}

function add(kind, item) {
  const prefix = kind === 'deals' ? 'd' : 'b';
  const record = { ...item, id: `${prefix}${crypto.randomBytes(4).toString('hex')}` };
  state[kind].push(record);
  save();
  return record;
}

function remove(kind, id) {
  const before = state[kind].length;
  state[kind] = state[kind].filter((x) => x.id !== id);
  if (state[kind].length !== before) save();
  return state[kind].length !== before;
}

module.exports = { list, get, add, remove };
