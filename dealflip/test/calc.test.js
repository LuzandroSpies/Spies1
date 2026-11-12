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
  assert.ok(a.flags.some((f) => /over the 70% rule/.test(f.text)));
});

test('a healthy deal is marked as working', () => {
  const a = analyzeDeal({ arv: 168000, contractPrice: 92000, buyerPrice: 95000, repairs: 22000, yourCosts: 500 });
  assert.strictEqual(a.assignmentFee, 3000);
  assert.strictEqual(a.yourNet, 2500);
  assert.strictEqual(a.verdict, 'works');
});

test('contract above buyer max is flagged', () => {
  const a = analyzeDeal({ arv: 100000, contractPrice: 80000, buyerPrice: 85000, repairs: 10000 });
  assert.ok(a.flags.some((f) => f.level === 'bad' && /no room for a fee/.test(f.text)));
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
