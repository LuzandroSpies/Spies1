'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { purchaseAgreement, assignmentAgreement } = require('../lib/contracts');

const deal = { address: '412 Example Ave', city: 'Sampletown', county: 'Lake', state: 'OH', saleType: 'Off-market' };

test('purchase agreement has the free-look cancel right, capped risk and assignment disclosure', () => {
  const doc = purchaseAgreement(deal, { price: 11559, earnestMoney: 500, inspectionDays: 14, closingDays: 30, buyerName: 'Test LLC', sellerName: 'Jane Owner', titleCompany: 'Main St Title' });
  assert.match(doc, /Buyer: Test LLC and\/or assigns/);
  assert.match(doc, /Buyer has 14 days/);
  assert.match(doc, /cancel this Agreement for any reason or no reason/);
  assert.match(doc, /return all earnest money to Buyer/);
  assert.match(doc, /sole and exclusive remedy is to keep the earnest money/);
  assert.match(doc, /SELLER DISCLOSURE/);
  assert.match(doc, /\$11,559/);
  assert.match(doc, /\$500 as earnest money with Main St Title/);
  assert.match(doc, /attorney licensed in OH/);
});

test('blank fields stay as fill-in lines, and tax sales get a warning', () => {
  const doc = purchaseAgreement({ ...deal, saleType: 'Tax Deed' }, { price: 1000 });
  assert.match(doc, /Seller: _{5,}/);
  assert.match(doc, /county auction, there is no seller to sign/);
});

test('assignment agreement states the fee and total', () => {
  const doc = assignmentAgreement(deal, { buyerName: 'Test LLC', assigneeDeposit: 1000, titleCompany: 'Main St Title' }, { name: 'Sample Buyer: Lakeside Rehab LLC' }, { contractPrice: 11559, buyerPrice: 30000 });
  assert.match(doc, /Assignee: Lakeside Rehab LLC/);
  assert.match(doc, /assignment fee of \$18,441/);
  assert.match(doc, /total cost is \$30,000/);
  assert.match(doc, /deposit \$1,000 with Main St Title/);
  assert.match(doc, /estimate only/);
});
