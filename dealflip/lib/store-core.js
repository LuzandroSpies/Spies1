'use strict';

// Storage logic with no file access, shared by the file store (server.js),
// Netlify Blobs (lib/netlify-handler.js) and the browser preview.
// The same interface is implemented in the browser preview on top of localStorage.
function createStore({ load, save, newId, seed = () => ({ deals: [], buyers: [], settings: {} }) }) {
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

module.exports = { createStore };
