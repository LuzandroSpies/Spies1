'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseCsv, importCsv } = require('../lib/importer');

test('parseCsv handles quotes, commas, newlines and CRLF', () => {
  const rows = parseCsv('a,b\r\n"1,2","say ""hi"""\n"multi\nline",3\n\n');
  assert.deepStrictEqual(rows, [['a', 'b'], ['1,2', 'say "hi"'], ['multi\nline', '3']]);
});

test('importCsv maps county-style headers and fills defaults', () => {
  const csv = [
    'Parcel Number,Owner Name,Property Address,City,Opening Bid,Market Value,Sale Date,Land Use',
    '12-345,JANE DOE,100 Oak St,Sampletown,"$4,500","$80,000",12/08/2026,Single Family Residential',
    '12-346,JOHN ROE,200 Elm St,Sampletown,3000,,12/08/2026,Vacant Land',
    '12-347,X,,Sampletown,3000,50000,,',
    '12-348,Y,300 Pine St,Sampletown,,50000,,',
    '12-349,Z,100 OAK ST.,Sampletown,4500,80000,,',
  ].join('\n');
  const r = importCsv(csv, { saleType: 'Tax Deed', county: 'Lake', state: 'oh', repairPct: 0.25 }, []);
  assert.strictEqual(r.deals.length, 2);
  const [a, b] = r.deals;
  assert.strictEqual(a.address, '100 Oak St');
  assert.strictEqual(a.askingPrice, 4500);
  assert.strictEqual(a.estimatedValue, 80000);
  assert.strictEqual(a.estimatedRepairs, 20000);
  assert.strictEqual(a.condition, 'medium');
  assert.strictEqual(a.state, 'OH');
  assert.strictEqual(a.county, 'Lake');
  assert.strictEqual(a.saleDate, '2026-12-08');
  assert.strictEqual(a.parcelId, '12-345');
  assert.strictEqual(a.ownerName, 'JANE DOE');
  assert.strictEqual(b.propertyType, 'land');
  assert.match(b.notes, /without a value/);
  assert.deepStrictEqual(r.skipped.map((s) => s.row), [4, 5, 6]);
  assert.match(r.skipped[2].reason, /already in your deals/);
});

test('importCsv skips rows already in the store and rejects files with no address column', () => {
  const r = importCsv('Address,Price\n1 A St,1000', {}, [{ address: '1 a st', city: '' }]);
  assert.strictEqual(r.deals.length, 0);
  assert.match(importCsv('Foo,Bar\n1,2').skipped[0].reason, /address column/);
});
