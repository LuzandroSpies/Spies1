'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { fileStore } = require('./lib/store');
const { createApi } = require('./lib/api');
const { checkValueAndRent } = require('./lib/comps');
const { fetchCsv } = require('./lib/sources');
const ai = require('./lib/ai');

const PASSWORD = process.env.DEALFLIP_PASSWORD || '';
const RENTCAST_KEY = process.env.RENTCAST_API_KEY || '';
const PUBLIC_DIR = path.join(__dirname, 'public');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '6mb' })); // CSV imports arrive as JSON text

const handle = createApi({
  store: fileStore(),
  ai,
  comps: RENTCAST_KEY ? (deal) => checkValueAndRent(deal, { apiKey: RENTCAST_KEY }) : null,
  fetchCsv: (url) => fetchCsv(url),
});

async function respond(req, res, routePath) {
  try {
    res.json(await handle(req.method, routePath, req.body || {}, req.query || {}));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server' });
  }
}

// ---- Public: the investor sign-up form. Everything else needs the password. ----
app.get(['/join', '/join.html'], (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'join.html')));
app.post('/api/join', (req, res) => respond(req, res, '/join'));

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Simple browser login (HTTP Basic auth). Any username; the password is DEALFLIP_PASSWORD.
app.use((req, res, next) => {
  if (!PASSWORD) return next();
  if (safeEqual(req.headers['x-dealflip-password'] || '', PASSWORD)) return next(); // the app's own sign-in
  const [scheme, encoded] = String(req.headers.authorization || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const pass = Buffer.from(encoded, 'base64').toString('utf8').split(':').slice(1).join(':');
    if (safeEqual(pass, PASSWORD)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="DealFlip", charset="UTF-8"').status(401).send('Password required');
});

app.use(express.static(PUBLIC_DIR));
app.use('/api', (req, res) => respond(req, res, req.path));

// Pull every saved list once a day (and shortly after start-up).
const DAY = 24 * 60 * 60 * 1000;
async function pullAll() {
  try {
    const results = await handle.runAllSources();
    for (const r of results) console.log(`[lists] ${r.name || r.id}: ${r.lastResult?.ok ? `${r.lastResult.added} new` : `failed: ${r.lastResult?.error}`}`);
  } catch (err) {
    console.error('[lists] pull failed', err);
  }
}

if (require.main === module) {
  const port = process.env.PORT || 3100;
  app.listen(port, () => {
    console.log(`DealFlip running at http://localhost:${port}`);
    if (!PASSWORD) console.warn('Warning: DEALFLIP_PASSWORD is not set, so anyone who can reach this server can see your deals. Set it before putting the app online.');
    if (!RENTCAST_KEY) console.log('Value checks are off. Set RENTCAST_API_KEY to turn them on.');
  });
  setTimeout(pullAll, 60 * 1000).unref();
  setInterval(pullAll, DAY).unref();
}

module.exports = app;
