'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { cleanPipeline, summarize, addDays, daysBetween } = require('../lib/pipeline');

test('date helpers work in whole UTC days', () => {
  assert.strictEqual(addDays('2026-11-25', 10), '2026-12-05');
  assert.strictEqual(daysBetween('2026-11-13', '2026-11-30'), 17);
  assert.strictEqual(daysBetween('bad', '2026-11-30'), null);
});

test('cleanPipeline validates stage and computes the fee', () => {
  const p = cleanPipeline({ stage: 'contract', contractPrice: 20000, buyerPrice: 32000, contractDate: '2026-11-10', inspectionDays: 10 });
  assert.strictEqual(p.expectedFee, 12000);
  assert.throws(() => cleanPipeline({ stage: 'nope' }));
  assert.strictEqual(cleanPipeline({ offerDate: '11/10/2026' }).offerDate, '');
});

test('summarize totals fees by stage and raises deadline alerts', () => {
  const mk = (id, pipeline) => ({ id, address: `${id} Main St`, pipeline: cleanPipeline(pipeline) });
  const deals = [
    mk('a', { stage: 'contract', contractPrice: 10000, buyerPrice: 20000, contractDate: '2026-11-04', inspectionDays: 10, earnestMoney: 500 }), // free-look ends 11-14
    mk('b', { stage: 'contract', contractPrice: 10000, buyerPrice: 15000, contractDate: '2026-11-01', inspectionDays: 7 }), // ended 11-08
    mk('c', { stage: 'assigned', contractPrice: 50000, buyerPrice: 58000, closingDate: '2026-11-18' }),
    mk('d', { stage: 'offer', offerDate: '2026-11-08' }),
    mk('e', { stage: 'closed', contractPrice: 1000, buyerPrice: 6000 }),
    { id: 'f', address: 'no pipeline' },
  ];
  const s = summarize(deals, { today: '2026-11-13', goal: { amount: 30000, deadline: '2026-11-30' } });
  assert.deepStrictEqual(s.totals, { closed: 5000, assigned: 8000, contract: 15000 });
  assert.strictEqual(s.goal.remaining, 2000);
  assert.strictEqual(s.goal.daysLeft, 17);
  assert.strictEqual(s.columns.contract.length, 2);
  assert.strictEqual(s.alerts[0].level, 'bad');
  assert.match(s.alerts[0].text, /b Main St.*ended 5 days ago/);
  assert.ok(s.alerts.some((a) => /a Main St ends in 1 day /.test(a.text)));
  assert.ok(s.alerts.some((a) => /c Main St closes in 5 days/.test(a.text)));
  assert.ok(s.alerts.some((a) => /Follow up.*d Main St.*5 days/.test(a.text)));
});
