'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { creativeAnalysis, cleanCreative } = require('../lib/creative');

test('subject-to: entry fee, cash flow, equity and rate savings', () => {
  const r = creativeAnalysis({ value: 250000, loanBalance: 180000, loanRate: 3, loanPayment: 1300, arrears: 2000, sellerCash: 5000, yourFee: 10000, closingCosts: 3000, rent: 2100, loanType: 'Conventional' });
  assert.strictEqual(r.structure, 'subject-to');
  assert.strictEqual(r.entryFee, 20000); // 5000 + 2000 + 3000 + 10000
  assert.strictEqual(r.expenses, 441); // 21% of rent
  assert.strictEqual(r.cashFlow, 359); // 2100 - 1300 - 441
  assert.strictEqual(r.equity, 70000);
  assert.strictEqual(r.cashOnCash, 21.5);
  assert.ok(r.rateSavings > 400, `rate savings ${r.rateSavings}`); // 3% vs 7% on $180k
  assert.strictEqual(r.verdict, 'works');
  assert.ok(r.flags.some((f) => /due-on-sale/.test(f.text)));
  assert.ok(r.flags.some((f) => /behind/.test(f.text)));
});

test('seller finance on a free-and-clear house', () => {
  const r = creativeAnalysis({ value: 150000, noteAmount: 130000, noteRate: 5, noteYears: 30, balloonYears: 7, sellerCash: 10000, yourFee: 8000, rent: 1500 });
  assert.strictEqual(r.structure, 'seller-finance');
  assert.strictEqual(r.notePayment, 698);
  assert.strictEqual(r.price, 140000);
  assert.ok(r.flags.some((f) => /balloon/.test(f.text)));
  assert.ok(!r.flags.some((f) => /due-on-sale/.test(f.text)));
});

test('hybrid with negative cash flow does not work; VA loan is flagged', () => {
  const r = creativeAnalysis({ value: 200000, loanBalance: 150000, loanRate: 6.5, loanPayment: 1400, noteAmount: 40000, noteRate: 0, noteYears: 10, rent: 1700, loanType: 'VA' });
  assert.strictEqual(r.structure, 'hybrid');
  assert.strictEqual(r.notePayment, 333); // 0% over 10 years
  assert.ok(r.cashFlow < 0);
  assert.strictEqual(r.verdict, 'does-not-work');
  assert.ok(r.flags.some((f) => /VA loan/.test(f.text)));
});

test('missing loan and rent are explained; inputs are cleaned', () => {
  const r = creativeAnalysis({});
  assert.strictEqual(r.verdict, 'does-not-work');
  assert.ok(r.flags.some((f) => /loan balance/.test(f.text)));
  assert.deepStrictEqual(cleanCreative({ loanBalance: '-5', loanType: 'Weird', junk: 1, lender: 'Bank' }), { loanBalance: 0, loanType: 'Unknown', lender: 'Bank' });
});
