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

const patch = (p, body) => fetch(base + p, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('import a CSV, then filter to deals that work', async () => {
  const csv = 'Address,City,Opening Bid,Market Value\n9 Import Rd,Townville,5000,90000\n10 Import Rd,Townville,85000,90000\n11 Import Rd,Townville,2000,\n';
  const r = await (await post('/api/deals/import', { csv, defaults: { saleType: 'Tax Deed', state: 'TX', county: 'Test', source: 'Test list', repairPct: 0.2 } })).json();
  assert.strictEqual(r.added, 3);
  assert.deepStrictEqual(r.counts, { works: 1, tight: 0, 'does-not-work': 1, 'needs-value': 1 });
  const works = await (await fetch(`${base}/api/deals?source=Test%20list&verdict=works`)).json();
  assert.deepStrictEqual(works.map((d) => d.address), ['9 Import Rd']);
  const again = await (await post('/api/deals/import', { csv })).json();
  assert.strictEqual(again.added, 0);
  assert.strictEqual((await post('/api/deals/import', { csv: ' ' })).status, 400);
});

test('pipeline updates, goal settings and summary', async () => {
  const bad = await patch('/api/deals/d3/pipeline', { stage: 'bogus' });
  assert.strictEqual(bad.status, 400);
  const d = await (await patch('/api/deals/d3/pipeline', { stage: 'assigned', contractPrice: 90000, buyerPrice: 98000, buyerId: 'b2', closingDate: '2099-01-01' })).json();
  assert.strictEqual(d.pipeline.expectedFee, 8000);
  const g = await (await fetch(`${base}/api/settings/goal`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: 40000, deadline: '2099-12-31' }) })).json();
  assert.strictEqual(g.amount, 40000);
  const s = await (await fetch(`${base}/api/pipeline`)).json();
  assert.strictEqual(s.totals.assigned, 8000);
  assert.strictEqual(s.goal.amount, 40000);
  assert.strictEqual(s.columns.assigned[0].id, 'd3');
});
