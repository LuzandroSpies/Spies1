'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dealflip-'));
process.env.DEALFLIP_STORE = path.join(tmp, 'store.json');
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
process.env.HOME = tmp; // no `ant` profile, so AI helpers use templates
const app = require('../server');

let base, server;
test.before(() => new Promise((r) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }));
test.after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('lists sample deals with a quick verdict', async () => {
  const deals = await (await fetch(`${base}/api/deals`)).json();
  assert.ok(deals.length >= 6);
  assert.ok(deals[0].quick.verdict);
  const tax = await (await fetch(`${base}/api/deals?saleType=Tax%20Deed`)).json();
  assert.ok(tax.every((d) => d.saleType === 'Tax Deed'));
});

test('analyze, match buyers and draft without an API key', async () => {
  const a = await (await post('/api/deals/d1/analyze', { buyerPrice: 50000 })).json();
  assert.strictEqual(a.assignmentFee, 50000 - 11559);
  const matches = await (await post('/api/deals/d1/buyers', { price: 30000 })).json();
  assert.strictEqual(matches[0].buyer.id, 'b1');
  const offer = await (await post('/api/deals/d1/ai/offer', { terms: { price: 11000, buyerName: 'Test LLC' } })).json();
  assert.strictEqual(offer.ai, false);
  assert.match(offer.text, /Test LLC and\/or assigns/);
  assert.match(offer.text, /auctions/);
  const email = await (await post('/api/deals/d1/ai/outreach', { buyerId: 'b1', price: 30000 })).json();
  assert.match(email.text, /\$30,000/);
  const review = await (await post('/api/deals/d1/ai/review', {})).json();
  assert.match(review.text, /Verdict/);
});

test('adds, validates and deletes a deal', async () => {
  assert.strictEqual((await post('/api/deals', { city: 'X' })).status, 400);
  const created = await (await post('/api/deals', { address: '1 Test St', askingPrice: '5000', junk: 'ignored' })).json();
  assert.strictEqual(created.askingPrice, 5000);
  assert.strictEqual(created.junk, undefined);
  const del = await (await fetch(`${base}/api/deals/${created.id}`, { method: 'DELETE' })).json();
  assert.strictEqual(del.deleted, true);
});

test('unknown deal returns 404', async () => {
  assert.strictEqual((await post('/api/deals/nope/analyze', {})).status, 404);
});

test('contract endpoints fill templates from the deal', async () => {
  const p = await (await post('/api/deals/d3/contracts/purchase', { terms: { price: 90000, buyerName: 'Me LLC', inspectionDays: 7 } })).json();
  assert.match(p.text, /\$90,000/);
  assert.match(p.text, /Buyer has 7 days/);
  const a = await (await post('/api/deals/d3/contracts/assignment', { buyerId: 'b2', terms: { buyerName: 'Me LLC' }, inputs: { contractPrice: 90000, buyerPrice: 95000 } })).json();
  assert.match(a.text, /assignment fee of \$5,000/);
  assert.strictEqual((await post('/api/deals/d3/contracts/assignment', { buyerId: 'nope' })).status, 404);
});
