'use strict';

// Runs the DealFlip API as a Netlify Function. All data (deals, investors,
// settings) is one JSON document in Netlify Blobs, loaded at the start of each
// request and saved only if the request changed it. `blobs` is any object with
// get(key, {type:'json'}) and setJSON(key, value), so tests can pass a fake.
const crypto = require('crypto');
const { createStore } = require('./store-core');
const { createApi } = require('./api');

const SAMPLE_DEALS = require('../data/sample-deals.json');
const SAMPLE_BUYERS = require('../data/sample-buyers.json');

const KEY = 'state';
const PUBLIC_ROUTES = new Set(['POST join']);

function seedState() {
  return {
    deals: SAMPLE_DEALS.map((d) => ({ ...d, sample: true, source: 'Sample' })),
    buyers: SAMPLE_BUYERS.map((b) => ({ ...b, sample: true })),
    settings: {},
  };
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

async function withStore(blobs, fn) {
  const saved = await blobs.get(KEY, { type: 'json' });
  let changed = null;
  const store = createStore({
    load: () => saved || seedState(),
    save: (state) => {
      changed = state;
    },
    newId: (kind) => `${kind === 'deals' ? 'd' : 'b'}${crypto.randomBytes(4).toString('hex')}`,
  });
  const out = await fn(store);
  if (changed) await blobs.setJSON(KEY, changed);
  return out;
}

// makeHandler({ blobs, password, ai, comps, fetchCsv }) -> (Request) => Response
function makeHandler({ blobs, password, ai, comps = null, fetchCsv = null }) {
  return async function handler(req) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/(\.netlify\/functions\/)?api/, '') || '/';
    const routeKey = `${req.method} ${path.split('/').filter(Boolean).join('/')}`;

    if (!PUBLIC_ROUTES.has(routeKey)) {
      if (!password) return json(503, { error: 'Set DEALFLIP_PASSWORD in Netlify (Site configuration, Environment variables) to turn the app on.' });
      if (!safeEqual(req.headers.get('x-dealflip-password') || '', password)) return json(401, { error: 'Wrong or missing password' });
    }

    let body = {};
    if (req.method !== 'GET' && req.method !== 'DELETE') {
      try {
        body = (await req.json()) || {};
      } catch {
        body = {};
      }
    }
    const query = Object.fromEntries(url.searchParams);

    try {
      const result = await withStore(blobs, (store) => createApi({ store, ai, comps, fetchCsv })(req.method, path, body, query));
      return json(200, result);
    } catch (err) {
      if (err.status) return json(err.status, { error: err.message });
      console.error(err);
      return json(500, { error: 'Something went wrong on the server' });
    }
  };
}

// Daily job: pull every saved list link.
async function runDailyPull({ blobs, ai, fetchCsv }) {
  return withStore(blobs, (store) => createApi({ store, ai, fetchCsv }).runAllSources());
}

module.exports = { makeHandler, runDailyPull, seedState };
