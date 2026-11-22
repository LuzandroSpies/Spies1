'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { makeHandler, runDailyPull } = require('../lib/netlify-handler');

function fakeBlobs() {
  const data = new Map();
  let writes = 0;
  return {
    get: async (k) => (data.has(k) ? JSON.parse(data.get(k)) : null),
    setJSON: async (k, v) => { writes++; data.set(k, JSON.stringify(v)); },
    get writes() { return writes; },
  };
}
const ai = { MODEL: 'x', aiAvailable: () => false };
const req = (method, path, { body, password } = {}) =>
  new Request(`https://example.netlify.app${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(password !== undefined ? { 'X-DealFlip-Password': password } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

test('needs a password to be configured, and the right one to be sent', async () => {
  const off = makeHandler({ blobs: fakeBlobs(), password: '', ai });
  assert.strictEqual((await off(req('GET', '/api/deals'))).status, 503);
  const h = makeHandler({ blobs: fakeBlobs(), password: 'pw', ai });
  assert.strictEqual((await h(req('GET', '/api/deals'))).status, 401);
  assert.strictEqual((await h(req('GET', '/api/deals', { password: 'nope' }))).status, 401);
  const ok = await h(req('GET', '/api/deals', { password: 'pw' }));
  assert.strictEqual(ok.status, 200);
  assert.ok((await ok.json()).length >= 6, 'starts with the sample deals');
});

test('saves changes to Blobs and only writes when something changed', async () => {
  const blobs = fakeBlobs();
  const h = makeHandler({ blobs, password: 'pw', ai });
  await h(req('GET', '/api/deals', { password: 'pw' }));
  assert.strictEqual(blobs.writes, 0);
  const created = await (await h(req('POST', '/api/deals', { password: 'pw', body: { address: '1 Netlify Rd', askingPrice: 5000 } }))).json();
  assert.strictEqual(blobs.writes, 1);
  // A fresh handler (like a new function instance) sees the saved deal.
  const h2 = makeHandler({ blobs, password: 'pw', ai });
  const got = await (await h2(req('GET', `/api/deals/${created.id}`, { password: 'pw' }))).json();
  assert.strictEqual(got.address, '1 Netlify Rd');
  assert.strictEqual((await h2(req('GET', '/api/deals/missing', { password: 'pw' }))).status, 404);
});

test('investor sign-up is public; daily pull runs saved links', async () => {
  const blobs = fakeBlobs();
  const h = makeHandler({ blobs, password: 'pw', ai, fetchCsv: async () => 'Address,City,Opening Bid,Market Value\n5 Daily St,Town,4000,90000\n' });
  const join = await h(req('POST', '/api/join', { body: { name: 'Inv', contact: 'i@example.com', states: ['OH'] } }));
  assert.strictEqual(join.status, 200);
  await h(req('POST', '/api/sources', { password: 'pw', body: { name: 'Daily', url: 'https://example.com/l.csv' } }));
  const results = await runDailyPull({ blobs, ai, fetchCsv: async () => 'Address,City,Opening Bid,Market Value\n5 Daily St,Town,4000,90000\n' });
  assert.strictEqual(results[0].lastResult.added, 1);
  const deals = await (await h(req('GET', '/api/deals?source=Daily', { password: 'pw' }))).json();
  assert.strictEqual(deals.length, 1);
});
