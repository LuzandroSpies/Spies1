'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createStore } = require('../lib/store');
const { createApi } = require('../lib/api');
const { checkValueAndRent } = require('../lib/comps');
const { cleanSource } = require('../lib/sources');

const ai = { MODEL: 'x', aiAvailable: () => false };
function memStore() {
  let n = 0;
  return createStore({
    load: () => ({ deals: [{ id: 'd1', address: '1 Main St', city: 'Townville', state: 'OH', askingPrice: 10000, estimatedValue: 100000, estimatedRepairs: 20000, titleAndLiens: 0, propertyType: 'single-family', beds: 3, baths: 1, sqft: 1200 }], buyers: [], settings: {} }),
    save: () => {},
    newId: (k) => `${k[0]}${++n}`,
  });
}

test('RentCast client builds the request and shapes the answer', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, key: opts.headers['X-Api-Key'] });
    const body = url.includes('/avm/value')
      ? { price: 98000.4, priceRangeLow: 90000, priceRangeHigh: 106000, comparables: [{ formattedAddress: '5 Oak St', price: 99000, bedrooms: 3, bathrooms: 1, squareFootage: 1150, distance: 0.234, status: 'Inactive', removedDate: '2026-09-01T00:00:00Z' }] }
      : { rent: 1150, rentRangeLow: 1000, rentRangeHigh: 1300, comparables: [] };
    return { ok: true, status: 200, json: async () => body };
  };
  const deal = { address: '1 Main St', city: 'Townville', state: 'OH', zip: '44000', propertyType: 'single-family', beds: 3, baths: 1, sqft: 1200 };
  const r = await checkValueAndRent(deal, { apiKey: 'k', fetchImpl: fakeFetch });
  assert.strictEqual(calls.length, 2);
  assert.ok(calls.every((c) => c.key === 'k'));
  assert.match(calls[0].url, /address=1\+Main\+St%2C\+Townville%2C\+OH\+44000/);
  assert.match(calls[0].url, /propertyType=Single\+Family/);
  assert.strictEqual(r.value.estimate, 98000);
  assert.deepStrictEqual(r.value.comps[0], { address: '5 Oak St', price: 99000, beds: 3, baths: 1, sqft: 1150, distanceMiles: 0.23, status: 'Inactive', date: '2026-09-01' });
  assert.strictEqual(r.rent.estimate, 1150);
  await assert.rejects(checkValueAndRent(deal, {}), /RENTCAST_API_KEY/);
  const denied = async () => ({ ok: false, status: 401 });
  await assert.rejects(checkValueAndRent(deal, { apiKey: 'bad', fetchImpl: denied }), /rejected the API key/);
});

test('comps route saves the result and fills in rent; without a key it says how to turn it on', async () => {
  const store = memStore();
  const off = createApi({ store, ai });
  await assert.rejects(off('POST', '/api/deals/d1/comps'), (e) => e.status === 501);
  const on = createApi({ store, ai, comps: async () => ({ source: 'RentCast', value: { estimate: 95000 }, rent: { estimate: 1100 } }) });
  const d = await on('POST', '/api/deals/d1/comps');
  assert.strictEqual(d.comps.value.estimate, 95000);
  assert.strictEqual(d.estimatedRent, 1100);
  const rental = await on('POST', '/api/deals/d1/rental', { inputs: {}, rental: {} });
  assert.strictEqual(rental.inputs.rent, 1100);
  assert.strictEqual(rental.rentSource, 'RentCast');
  const mine = await on('POST', '/api/deals/d1/rental', { rental: { rent: 1300 } });
  assert.deepStrictEqual([mine.inputs.rent, mine.rentSource], [1300, 'you']);
});

test('saved list sources pull, import and record the result', async () => {
  const store = memStore();
  const csv = 'Address,City,Opening Bid,Market Value\n2 Elm St,Townville,5000,90000\n';
  let fail = false;
  const handle = createApi({ store, ai, now: () => new Date('2026-11-14T12:00:00Z'), fetchCsv: async () => { if (fail) throw new Error('The link returned 404'); return csv; } });
  await assert.rejects(handle('POST', '/api/sources', { name: 'X', url: 'not a link' }), (e) => e.status === 400);
  const src = await handle('POST', '/api/sources', { name: 'Lake Dec', url: 'https://example.com/list.csv', state: 'oh', county: 'Lake' });
  assert.strictEqual(src.state, 'OH');
  const r1 = await handle('POST', `/api/sources/${src.id}/run`);
  assert.strictEqual(r1.lastResult.added, 1);
  const again = await handle.runAllSources();
  assert.strictEqual(again[0].lastResult.added, 0); // duplicate skipped
  fail = true;
  const r3 = await handle('POST', `/api/sources/${src.id}/run`);
  assert.deepStrictEqual(r3.lastResult, { ok: false, error: 'The link returned 404' });
  const saved = await handle('GET', '/api/sources');
  assert.strictEqual(saved[0].lastResult.ok, false);
  const deals = await handle('GET', '/api/deals', {}, { source: 'Lake Dec' });
  assert.strictEqual(deals[0].county, 'Lake');
  assert.strictEqual((await handle('DELETE', `/api/sources/${src.id}`)).deleted, true);
});

test('cleanSource only accepts web links', () => {
  assert.throws(() => cleanSource({ name: 'x', url: 'file:///etc/passwd' }), /web links/);
  assert.throws(() => cleanSource({ name: '', url: 'https://a.b/c.csv' }), /name/);
});

test('investor sign-up validates and lands on the buyers list', async () => {
  const store = memStore();
  const handle = createApi({ store, ai });
  await assert.rejects(handle('POST', '/api/join', { name: 'A' }), /email or phone/);
  await assert.rejects(handle('POST', '/api/join', { name: 'A', contact: 'a@example.com' }), /state/);
  await handle('POST', '/api/join', { name: 'Test Capital', contact: 'a@example.com', states: ['oh'], counties: ['Lake'], minPrice: '5000', maxPrice: '80000', strategies: ['rental'], proofOfFunds: true, sneaky: 'x' });
  const [b] = await handle('GET', '/api/buyers');
  assert.strictEqual(b.signup, true);
  assert.deepStrictEqual(b.states, ['OH']);
  assert.deepStrictEqual(b.strategies, ['rental']);
  assert.strictEqual(b.sneaky, undefined);
});

test('deal emails to rental buyers include rental numbers', async () => {
  const store = memStore();
  const handle = createApi({ store, ai: { ...ai, draftOutreach: async (d, b, price, a, rental) => ({ rental }) } });
  await handle('POST', '/api/buyers', { name: 'Hold Co', states: 'OH', strategies: 'rental', propertyTypes: 'single-family', rehabLevels: 'medium' });
  await handle('POST', '/api/buyers', { name: 'Flip Co', states: 'OH', strategies: 'flip', propertyTypes: 'single-family', rehabLevels: 'medium' });
  const [hold, flip] = await handle('GET', '/api/buyers');
  const r1 = await handle('POST', '/api/deals/d1/ai/outreach', { buyerId: hold.id, price: 45000 });
  assert.ok(r1.rental && r1.rental.inputs.buyerPrice === 45000);
  const r2 = await handle('POST', '/api/deals/d1/ai/outreach', { buyerId: flip.id, price: 45000 });
  assert.strictEqual(r2.rental, null);
  const realAi = require('../lib/ai');
  delete process.env.ANTHROPIC_API_KEY;
  const real = createApi({ store, ai: realAi });
  const email = await real('POST', '/api/deals/d1/ai/outreach', { buyerId: hold.id, price: 45000 });
  assert.match(email.text, /As a rental: about \$\d/);
});

test('creative deals: save terms, analyze, match creative buyers, and draft creative documents', async () => {
  const store = memStore();
  delete process.env.ANTHROPIC_API_KEY;
  const handle = createApi({ store, ai: require('../lib/ai') });
  await assert.rejects(handle('PUT', '/api/deals/d1/creative', { mode: 'barter' }), (e) => e.status === 400);
  const saved = await handle('PUT', '/api/deals/d1/creative', { mode: 'creative', creative: { loanBalance: 70000, loanRate: 3.25, loanPayment: 650, loanType: 'FHA', lender: 'Example Bank', arrears: 1500, sellerCash: 3000, yourFee: 7000, rent: 1250 } });
  assert.strictEqual(saved.mode, 'creative');
  const c = await handle('POST', '/api/deals/d1/creative', {});
  assert.strictEqual(c.structure, 'subject-to');
  assert.strictEqual(c.entryFee, 3000 + 1500 + 3000 + 7000);
  assert.strictEqual(c.inputs.value, 100000); // from the deal

  await handle('POST', '/api/buyers', { name: 'Sub2 Co', states: 'OH', strategies: 'creative', maxEntryFee: 20000, minCashFlow: 200 });
  await handle('POST', '/api/buyers', { name: 'Cash Co', states: 'OH', strategies: 'flip', minPrice: 0, maxPrice: 200000 });
  const matches = await handle('POST', '/api/deals/d1/buyers', {});
  assert.strictEqual(matches[0].buyer.name, 'Sub2 Co');
  const cashCo = matches.find((m) => m.buyer.name === 'Cash Co');
  assert.ok(!cashCo || cashCo.reasons.includes('only buys with cash'));
  const cashMode = await handle('POST', '/api/deals/d1/buyers', { mode: 'cash', price: 50000 });
  assert.strictEqual(cashMode[0].buyer.name, 'Cash Co');

  const pa = await handle('POST', '/api/deals/d1/contracts/purchase', { terms: { buyerName: 'Me LLC', sellerName: 'Jane Owner' } });
  assert.match(pa.text, /SUBJECT TO EXISTING FINANCING/);
  assert.match(pa.text, /Example Bank/);
  assert.match(pa.text, /due-on-sale/);
  assert.match(pa.text, /\$1,500 in missed payments/);
  const [sub2] = (await handle('GET', '/api/buyers')).filter((b) => b.name === 'Sub2 Co');
  const asg = await handle('POST', '/api/deals/d1/contracts/assignment', { buyerId: sub2.id, terms: { buyerName: 'Me LLC' } });
  assert.match(asg.text, /entry fee"\) is about \$14,500/);
  const offer = await handle('POST', '/api/deals/d1/ai/offer', { terms: { buyerName: 'Me LLC' } });
  assert.match(offer.text, /take over your monthly mortgage payment of about \$650/);
  const email = await handle('POST', '/api/deals/d1/ai/outreach', { buyerId: sub2.id });
  assert.match(email.text, /Subject-to deal/);
  assert.match(email.text, /Entry fee: \$14,500/);
});

test('quick calculator: cash offer and creative cash-to-seller', async () => {
  const handle = createApi({ store: memStore(), ai });
  const cash = await handle('POST', '/api/calc/cash', { arv: 100000, repairs: 20000, fee: 10000, askingPrice: 35000 });
  assert.strictEqual(cash.investorMax, 50000);
  assert.strictEqual(cash.maxOffer, 40000);
  assert.strictEqual(cash.feeAtAsking, 15000);
  const cr = await handle('POST', '/api/calc/creative', { creative: { loanBalance: 150000, loanPayment: 1200, loanRate: 3, arrears: 2000, yourFee: 8000, rent: 1900, value: 200000 }, maxEntryFee: 25000 });
  assert.strictEqual(cr.structure, 'subject-to');
  assert.strictEqual(cr.maxSellerCash, 25000 - 2000 - 3000 - 8000);
  assert.strictEqual(cr.entryFee, 13000);
});
