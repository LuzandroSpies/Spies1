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

// ---------- Creative-finance versions ----------
// Subject-to (buyer takes over the seller's loan), seller finance (seller carries a
// loan), or both. These need extra seller disclosures: the loan stays in the
// seller's name, and the lender's due-on-sale clause still applies.

function pct(n) {
  return `${Number(n || 0).toFixed(2).replace(/\.00$/, '')}%`;
}

// Accept a creativeAnalysis result: its inputs plus the calculated figures.
const flat = (c = {}) => ({ ...(c.inputs || {}), ...c });

function creativeTermsLines(c) {
  const lines = [];
  let n = 1;
  if (c.loanBalance > 0) {
    lines.push(
      `(${n++}) Buyer takes title subject to the existing loan with ${v(c.lender)} (loan number ${BLANK}), with an unpaid balance of about ${money(c.loanBalance)} at ${pct(c.loanRate)} interest and a monthly payment of about ${money(c.loanPayment)} including taxes and insurance. The loan stays in Seller's name. Buyer will make every payment that comes due after closing.`,
    );
  }
  if (c.arrears > 0) lines.push(`(${n++}) Buyer will pay the ${money(c.arrears)} in missed payments and late fees at closing to bring the loan current.`);
  if (c.noteAmount > 0) {
    lines.push(
      `(${n++}) Seller will carry a loan to Buyer of ${money(c.noteAmount)} at ${pct(c.noteRate)} interest, repaid over ${c.noteYears} years in monthly payments of about ${money(c.notePayment)}` +
        (c.balloonYears > 0 ? `, with the remaining balance due in full ${c.balloonYears} years after closing.` : '.') +
        ' It will be secured by a recorded mortgage or deed of trust on the Property.',
    );
  }
  if (c.sellerCash > 0) lines.push(`(${n++}) Buyer will pay Seller ${money(c.sellerCash)} in cash at closing.`);
  return lines;
}

function creativePurchaseAgreement(deal, t = {}, analysis = {}) {
  const c = flat(analysis);
  const buyer = `${v(t.buyerName)} and/or assigns`;
  const dd = Number(t.inspectionDays) || 10;
  const closing = Number(t.closingDays) || 30;
  const titleCo = v(t.titleCompany);
  const subTo = c.loanBalance > 0;

  return [
    ...reviewNote(deal),
    subTo
      ? 'Creative deals need a title company and attorney experienced with subject-to and seller financing. Some states regulate these sales heavily, especially when the seller is behind on payments.'
      : 'Seller-financed sales can be regulated. Have an attorney confirm the loan terms meet your state rules.',
    '',
    subTo ? 'PURCHASE AGREEMENT (SUBJECT TO EXISTING FINANCING)' : 'PURCHASE AGREEMENT (SELLER FINANCING)',
    '',
    `Date: ${BLANK}`,
    '',
    '1. PARTIES',
    `Seller: ${v(t.sellerName)} ("Seller")`,
    `Buyer: ${buyer} ("Buyer")`,
    '',
    '2. PROPERTY',
    `${propertyLine(deal)}, tax parcel number ${BLANK} (the "Property").`,
    '',
    '3. PRICE AND HOW IT IS PAID',
    `The total purchase price is ${money(c.price)}, paid as follows:`,
    ...creativeTermsLines(c),
    '',
    '4. EARNEST MONEY',
    `Buyer will deposit ${money(Number(t.earnestMoney) || 0)} with ${titleCo} (the "Title Company") within 3 business days after both parties sign. It is credited to Buyer at closing.`,
    '',
    '5. DUE DILIGENCE PERIOD (BUYER MAY CANCEL FOR ANY REASON)',
    `Buyer has ${dd} days after both parties sign to review the Property, the loan statements and title. During this period Buyer may cancel for any reason by written notice, and all earnest money is returned to Buyer. After it, if Buyer does not close for a reason other than Seller's default or a title problem, Seller's only remedy is to keep the earnest money.`,
    '',
    ...(subTo
      ? [
          '6. SELLER DISCLOSURES ABOUT THE EXISTING LOAN (SELLER INITIALS EACH)',
          `a) The loan stays in my name after closing. If Buyer misses payments, my credit can be harmed and the lender can foreclose on the Property. ____`,
          `b) The loan has a "due-on-sale" clause. The lender may demand the full balance because the Property was sold. Buyer does not promise the lender won't do this. ____`,
          `c) Selling this way may limit my ability to get a new mortgage while this loan is open.${c.loanType === 'VA' ? ' My VA loan benefit stays tied to this Property until the loan is paid off.' : ''} ____`,
          `d) Buyer is not my agent, lawyer or financial adviser. I have been told I may get independent legal advice before signing, and I am not being rushed. ____`,
          '',
          '7. LOAN INFORMATION, PAYMENTS AND INSURANCE',
          `Seller will sign an authorization letting the lender share loan information with Buyer and the Title Company. Payments will be made through ${BLANK} (a third-party loan servicing company), so Seller can check that every payment is made. Buyer will keep the Property insured with the lender named as mortgagee, and will give Seller written proof of each payment on request.`,
          '',
          '8. IF BUYER STOPS PAYING',
          `If Buyer misses a payment on the existing loan and does not cure it within 30 days of written notice from Seller, Seller may require Buyer to deed the Property back to Seller, or to pay off or refinance the loan within ${BLANK} days.`,
          '',
        ]
      : [
          '6. SELLER LOAN DOCUMENTS',
          'The seller financing will be documented in a promissory note and a recorded mortgage or deed of trust, prepared or reviewed by an attorney or the Title Company. Payments will be made through a third-party loan servicing company so both parties have a record of every payment. Buyer will keep the Property insured with Seller named as mortgagee.',
          '',
          '7. SELLER DISCLOSURE',
          `Buyer is not Seller's agent, lawyer or financial adviser. Seller has been told Seller may get independent legal advice before signing. Seller initials: ____`,
          '',
          '8. (RESERVED)',
          '',
        ]),
    '9. ASSIGNMENT',
    'Buyer may assign this Agreement without Seller\'s consent. Seller understands Buyer may assign it to another investor and be paid a fee for doing so. Seller initials: ____',
    '',
    '10. CLOSING AND POSSESSION',
    `Closing will take place at the Title Company within ${closing} days after both parties sign. Seller will deliver a deed to Buyer at closing and give possession on the same day, unless agreed otherwise in writing. Property taxes and rents are prorated to the closing date.`,
    '',
    '11. GENERAL',
    `This is the entire agreement. Changes must be in writing and signed by both parties. It is governed by the laws of ${v(deal.state)} and may be signed electronically.`,
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

// Assignment to a creative investor: they take over the creative terms and pay the entry fee.
function creativeAssignmentAgreement(deal, t = {}, buyer = {}, analysis = {}) {
  const c = flat(analysis);
  const assignee = v(String(buyer.name || '').replace(/^Sample Buyer: /, ''));
  const deposit = Number(t.assigneeDeposit) || 0;
  return [
    ...reviewNote(deal),
    'ASSIGNMENT OF PURCHASE AGREEMENT (CREATIVE TERMS)',
    '',
    `Date: ${BLANK}`,
    '',
    '1. PARTIES',
    `Assignor: ${v(t.buyerName)} ("Assignor")`,
    `Assignee: ${assignee} ("Assignee")`,
    '',
    '2. THE ORIGINAL AGREEMENT',
    `Assignor is the buyer under a purchase agreement dated ${BLANK} with ${v(t.sellerName)} as seller, for ${propertyLine(deal)} (the "Property"), on these terms:`,
    ...creativeTermsLines(c),
    'Assignee confirms it has received and read a copy of that agreement, including the seller disclosures.',
    '',
    '3. ASSIGNMENT',
    'Assignor assigns all of its rights under the original agreement to Assignee. Assignee accepts and takes on all of the buyer\'s obligations, including every loan payment due after closing and the promises made to the seller about payments, insurance and servicing.',
    '',
    '4. ENTRY FEE AND ASSIGNMENT FEE',
    `Assignee's cash due at closing (the "entry fee") is about ${money(c.entryFee)}:`,
    c.sellerCash > 0 ? `- Cash to seller: ${money(c.sellerCash)}` : null,
    c.arrears > 0 ? `- Missed payments to bring the loan current: ${money(c.arrears)}` : null,
    `- Estimated closing and servicing setup costs: ${money(c.closingCosts)}`,
    `- Assignment fee to Assignor: ${money(c.yourFee)}`,
    '',
    '5. DEPOSIT',
    `Within 2 business days after signing, Assignee will deposit ${money(deposit)} with ${v(t.titleCompany)}. It is credited at closing and is non-refundable unless the seller defaults or title cannot be made insurable.`,
    '',
    '6. ASSIGNEE\'S OWN REVIEW',
    'Assignee is buying based on its own review of the Property, the loan statements, rents and title. Any value, rent, repair or cash-flow figure from Assignor is an estimate only.',
    '',
    '7. GENERAL',
    `This is the entire agreement. It is governed by the laws of ${v(deal.state)} and may be signed electronically.`,
    '',
    'SIGNATURES',
    '',
    `Assignor: ${BLANK}   Date: ${BLANK}`,
    `Assignee: ${BLANK}   Date: ${BLANK}`,
  ]
    .filter((l) => l !== null)
    .join('\n');
}

module.exports = { purchaseAgreement, assignmentAgreement, creativePurchaseAgreement, creativeAssignmentAgreement };
