'use strict';

// Fill-in-the-blank contract templates. These are deterministic on purpose:
// contract wording should not change from one generation to the next.
// They are starting drafts for an attorney to review, not finished legal documents.
const { money } = require('./calc');

const BLANK = '____________________';

function v(x) {
  return x === undefined || x === null || String(x).trim() === '' ? BLANK : String(x).trim();
}

function reviewNote(deal) {
  return [
    'NOTE TO YOU (delete before sending):',
    `This is a starting draft, not legal advice. Have a real estate attorney licensed in ${v(deal.state)} review it before use.`,
    'Some states require a state-approved contract form, a licensed agent or attorney, or specific wholesaler disclosures.',
    /tax/i.test(deal.saleType)
      ? 'This property is listed as a tax sale. If it is a county auction, there is no seller to sign this; it only applies if you contract with the current owner before the sale.'
      : null,
    '',
  ].filter((l) => l !== null);
}

function propertyLine(deal) {
  return `${v(deal.address)}, ${v(deal.city)}, ${v(deal.county)} County, ${v(deal.state)}`;
}

// Seller -> you ("and/or assigns"), with a free-look termination right.
function purchaseAgreement(deal, t = {}) {
  const buyer = `${v(t.buyerName)} and/or assigns`;
  const dd = Number(t.inspectionDays) || 10;
  const closing = Number(t.closingDays) || 30;
  const titleCo = v(t.titleCompany);
  const credits = Number(t.sellerCredits) || 0;

  return [
    ...reviewNote(deal),
    'PURCHASE AND SALE AGREEMENT',
    '',
    `Date: ${BLANK}`,
    '',
    '1. PARTIES',
    `Seller: ${v(t.sellerName)} ("Seller")`,
    `Buyer: ${buyer} ("Buyer")`,
    '',
    '2. PROPERTY',
    `${propertyLine(deal)}, tax parcel number ${BLANK}, with all improvements and fixtures (the "Property"). The legal description will be taken from the deed of record.`,
    '',
    '3. PURCHASE PRICE',
    `The purchase price is ${money(Number(t.price) || 0)}, paid in cash or certified funds at closing.` +
      (credits ? ` Seller will credit Buyer ${money(credits)} at closing.` : ''),
    '',
    '4. EARNEST MONEY',
    `Buyer will deposit ${money(Number(t.earnestMoney) || 0)} as earnest money with ${titleCo} (the "Title Company") within 3 business days after both parties sign. The earnest money is credited to Buyer at closing.`,
    '',
    '5. DUE DILIGENCE PERIOD (BUYER MAY CANCEL FOR ANY REASON)',
    `Buyer has ${dd} days after both parties sign (the "Due Diligence Period") to inspect and evaluate the Property. ` +
      'During the Due Diligence Period, Buyer may cancel this Agreement for any reason or no reason, in Buyer\'s sole discretion, by written notice to Seller. ' +
      'If Buyer cancels during the Due Diligence Period, the Title Company will return all earnest money to Buyer, and neither party will owe the other anything further.',
    '',
    '6. SELLER\'S REMEDY IS LIMITED TO THE EARNEST MONEY',
    'If Buyer fails to close after the Due Diligence Period for any reason other than Seller\'s default or a title problem under Section 7, ' +
      'Seller\'s sole and exclusive remedy is to keep the earnest money as liquidated damages. Seller waives any right to specific performance or other damages against Buyer.',
    '',
    '7. TITLE',
    'Seller will convey marketable and insurable title by general warranty deed, free of liens, judgments and encumbrances except recorded easements acceptable to Buyer. ' +
      'If title cannot be made marketable and insurable before closing, Buyer may cancel and receive all earnest money back.',
    '',
    '8. ASSIGNMENT AND SELLER DISCLOSURE',
    'Buyer may assign this Agreement to another person or company without Seller\'s consent, and Buyer is released from its obligations once the assignee assumes them.',
    'SELLER DISCLOSURE: Seller understands that (a) Buyer may assign this Agreement to another buyer instead of buying the Property itself; ' +
      '(b) Buyer may be paid a fee for that assignment, which may be a significant amount; (c) Buyer is not acting as Seller\'s agent or representing Seller; ' +
      'and (d) Seller may consult an attorney or real estate agent before signing.',
    `Seller initials: ${'_______'}`,
    '',
    '9. ACCESS',
    'Seller will give Buyer, Buyer\'s inspectors and contractors, and prospective assignees reasonable access to the Property with 24 hours\' notice before closing.',
    '',
    '10. CONDITION',
    'Buyer accepts the Property in its present "as-is" condition, subject to Buyer\'s rights in Section 5. Seller will provide any disclosures required by law.',
    '',
    '11. CLOSING',
    `Closing will take place at the Title Company on or before ${closing} days after both parties sign. ` +
      'Seller pays the cost of clearing title and any deed or transfer taxes customarily paid by sellers; Buyer pays its own recording and title insurance costs. ' +
      'Property taxes are prorated to the closing date. Possession is delivered at closing, vacant and broom-clean unless otherwise agreed in writing.',
    '',
    '12. RISK OF LOSS',
    'Seller bears the risk of loss until closing. If the Property is materially damaged before closing, Buyer may cancel and receive all earnest money back.',
    '',
    '13. GENERAL',
    `This is the entire agreement between the parties. Changes must be in writing and signed by both parties. Notices must be in writing (email is acceptable). ` +
      `This Agreement is governed by the laws of ${v(deal.state)}. It may be signed in counterparts and electronically.`,
    '',
    'SIGNATURES',
    '',
    `Seller: ${BLANK}   Date: ${BLANK}`,
    `Printed name: ${v(t.sellerName)}`,
    '',
    `Buyer: ${BLANK}   Date: ${BLANK}`,
    `Printed name: ${v(t.buyerName)}`,
  ].join('\n');
}

// You -> your cash buyer (the investor).
function assignmentAgreement(deal, t = {}, buyer = {}, prices = {}) {
  const contractPrice = Number(prices.contractPrice) || 0;
  const buyerPrice = Number(prices.buyerPrice) || 0;
  const fee = buyerPrice - contractPrice;
  const deposit = Number(t.assigneeDeposit) || 0;
  const assignee = v(String(buyer.name || '').replace(/^Sample Buyer: /, ''));

  return [
    ...reviewNote(deal),
    'ASSIGNMENT OF PURCHASE AND SALE AGREEMENT',
    '',
    `Date: ${BLANK}`,
    '',
    '1. PARTIES',
    `Assignor: ${v(t.buyerName)} ("Assignor")`,
    `Assignee: ${assignee} ("Assignee")`,
    '',
    '2. THE ORIGINAL AGREEMENT',
    `Assignor is the buyer under a Purchase and Sale Agreement dated ${BLANK} with ${v(t.sellerName)} as seller (the "Original Agreement") ` +
      `for ${propertyLine(deal)} (the "Property"), at a purchase price of ${money(contractPrice)}. Assignee confirms it has received and read a copy of the Original Agreement.`,
    '',
    '3. ASSIGNMENT',
    'Assignor assigns to Assignee all of Assignor\'s rights under the Original Agreement. Assignee accepts the assignment and assumes all of the buyer\'s obligations under the Original Agreement, including paying the purchase price and closing on time.',
    '',
    '4. ASSIGNMENT FEE',
    `Assignee will pay Assignor an assignment fee of ${money(fee)}, paid through the Title Company at closing. ` +
      `Assignee's total cost is ${money(buyerPrice)} (the ${money(contractPrice)} purchase price plus the assignment fee), plus Assignee's own closing costs.`,
    '',
    '5. DEPOSIT',
    `Within 2 business days after signing, Assignee will deposit ${money(deposit)} with ${v(t.titleCompany)} (the "Title Company"). ` +
      'The deposit is credited toward the assignment fee at closing. It is non-refundable unless the seller defaults or title cannot be made marketable and insurable.',
    '',
    '6. CLOSING',
    'Assignee will close on or before the closing date in the Original Agreement. If Assignee fails to close for any reason other than the seller\'s default or a title failure, Assignor keeps the deposit and may assign the Original Agreement to someone else.',
    '',
    '7. ASSIGNEE\'S OWN DUE DILIGENCE',
    'Assignee is buying the Property "as-is" based on its own inspection and research. Any after-repair value, repair estimate, rent or other figure Assignor provided is an estimate only, and Assignor makes no promise about it. Assignee has had the chance to inspect the Property and review title before signing.',
    '',
    '8. GENERAL',
    `This is the entire agreement between the parties. Changes must be in writing and signed by both parties. This Assignment is governed by the laws of ${v(deal.state)}. It may be signed in counterparts and electronically.`,
    '',
    'SIGNATURES',
    '',
    `Assignor: ${BLANK}   Date: ${BLANK}`,
    `Printed name: ${v(t.buyerName)}`,
    '',
    `Assignee: ${BLANK}   Date: ${BLANK}`,
    `Printed name: ${assignee}`,
  ].join('\n');
}

module.exports = { purchaseAgreement, assignmentAgreement };
