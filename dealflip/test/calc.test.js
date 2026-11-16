'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { analyzeDeal, matchBuyer } = require('../lib/calc');

test('video example: $11,559 contract, $50k buyer price', () => {
  const a = analyzeDeal({ arv: 74000, contractPrice: 11559, buyerPrice: 50000 });
  assert.strictEqual(a.assignmentFee, 38441); // matches the calculator in the video
  assert.strictEqual(a.buyerMaxPrice, 51800); // 70% of 74k, no repairs entered
});

test('repairs and title costs make the $50k buyer price unrealistic', () => {
  const a = analyzeDeal({ arv: 74000, contractPrice: 11559, buyerPrice: 50000, repairs: 18000, titleAndLiens: 3500 });
  assert.strictEqual(a.buyerMaxPrice, 30300);
  assert.strictEqual(a.realisticFee, 18741);
  assert.ok(a.buyerProfit < 0, 'end buyer should lose money at $50k');
  assert.strictEqual(a.verdict, 'does-not-work');
  assert.ok(a.flags.some((f) => /more than they'd usually pay/.test(f.text)));
});

test('a healthy deal is marked as working', () => {
  const a = analyzeDeal({ arv: 168000, contractPrice: 92000, buyerPrice: 95000, repairs: 22000, yourCosts: 500 });
  assert.strictEqual(a.assignmentFee, 3000);
  assert.strictEqual(a.yourNet, 2500);
  assert.strictEqual(a.verdict, 'works');
});

test('contract above buyer max is flagged', () => {
  const a = analyzeDeal({ arv: 100000, contractPrice: 80000, buyerPrice: 85000, repairs: 10000 });
  assert.ok(a.flags.some((f) => f.level === 'bad' && /no room for your fee/.test(f.text)));
  assert.strictEqual(a.realisticFee, 0);
});

test('blank inputs fall back to defaults', () => {
  const a = analyzeDeal({ arv: '100000', contractPrice: '', buyerPrice: '60000', maoPct: '' });
  assert.strictEqual(a.inputs.maoPct, 0.7);
  assert.strictEqual(a.inputs.contractPrice, 0);
});

test('buyer matching scores county, price, type and rehab', () => {
  const deal = { state: 'OH', county: 'Lake', propertyType: 'single-family', condition: 'medium', askingPrice: 11559 };
  const buyer = { states: ['OH'], counties: ['Lake'], minPrice: 5000, maxPrice: 60000, propertyTypes: ['single-family'], rehabLevels: ['medium'], proofOfFunds: true };
  assert.strictEqual(matchBuyer(buyer, deal, 30000).score, 100);
  assert.strictEqual(matchBuyer({ ...buyer, proofOfFunds: false }, deal, 30000).score, 90);
  assert.strictEqual(matchBuyer(buyer, deal, 90000).score, 70);
});

test('a buyer price exactly at the 70% max is not flagged (float rounding)', () => {
  const a = analyzeDeal({ arv: 90000, contractPrice: 5000, buyerPrice: 45000, repairs: 18000 });
  assert.strictEqual(a.buyerMaxPrice, 45000);
  assert.strictEqual(a.verdict, 'works');
});

const { rentalAnalysis, monthlyPayment, estimateRent } = require('../lib/calc');

test('mortgage payment matches the standard formula', () => {
  assert.strictEqual(Math.round(monthlyPayment(100000, 0.06, 30)), 600); // 599.55
  assert.strictEqual(monthlyPayment(0, 0.06, 30), 0);
});

test('rental view: BRRRR on a healthy deal', () => {
  const r = rentalAnalysis({ arv: 168000, buyerPrice: 95000, repairs: 22000, rent: 1600, taxesYearly: 2400, insuranceYearly: 1200 });
  assert.strictEqual(r.allIn, 119850); // 95000 + 22000 + 3% closing
  assert.strictEqual(r.grossYearly, 19200);
  assert.strictEqual(r.opexYearly, 9552); // 31% of gross + taxes + insurance
  assert.strictEqual(r.noi, 9648);
  assert.strictEqual(r.cashFlowAfterRefi, -77); // 75% refi payment eats the cash flow
  assert.strictEqual(r.capRate, 8.1);
  assert.strictEqual(r.refiLoan, 126000);
  assert.ok(r.cashLeftIn < 0, 'refi returns all cash');
  assert.strictEqual(r.cashOnCash, null);
  assert.ok(r.flags.some((f) => /pay back all of the investor's cash/.test(f.text)));
});

test('rental view flags negative cash flow and estimates rent when missing', () => {
  const r = rentalAnalysis({ arv: 74000, buyerPrice: 50000, repairs: 18000 });
  assert.strictEqual(r.rentIsEstimate, true);
  assert.strictEqual(r.inputs.rent, estimateRent(74000));
  assert.ok(r.cashFlowAfterRefi < 0);
  assert.strictEqual(r.verdict, 'tight');
});

test('creative matching uses entry fee and cash flow, and separates cash-only buyers', () => {
  const deal = { state: 'OH', county: 'Lake', propertyType: 'single-family', condition: 'medium', askingPrice: 100000 };
  const creative = { entryFee: 15000, cashFlow: 300 };
  const creativeBuyer = { states: ['OH'], counties: ['Lake'], propertyTypes: ['single-family'], rehabLevels: ['medium'], strategies: ['creative'], maxEntryFee: 20000, minCashFlow: 250, proofOfFunds: true };
  const m = matchBuyer(creativeBuyer, deal, 0, creative);
  assert.strictEqual(m.score, 100);
  assert.ok(m.reasons.includes('buys creative deals'));
  const tooMuch = matchBuyer({ ...creativeBuyer, maxEntryFee: 10000 }, deal, 0, creative);
  assert.ok(tooMuch.score < m.score && tooMuch.reasons.some((r) => /over their/.test(r)));
  const cashOnly = matchBuyer({ ...creativeBuyer, strategies: ['flip'] }, deal, 0, creative);
  assert.ok(cashOnly.reasons.includes('only buys with cash'));
  const onCash = matchBuyer({ ...creativeBuyer, minPrice: 0, maxPrice: 200000 }, deal, 100000);
  assert.ok(onCash.reasons.includes('only buys creative deals'));
});
