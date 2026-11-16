'use strict';

// Creative-finance deal math, for investors who buy "subject-to" (taking over the
// seller's existing loan), with seller financing (the seller carries a loan), or a
// mix of both ("hybrid"). These investors judge a deal by three numbers:
//   1. Entry fee: the cash they bring to close (seller's cash, catching up missed
//      payments, closing costs and your fee).
//   2. Monthly cash flow: rent minus the loan payments and running costs.
//   3. Equity: value minus everything owed.
const { monthlyPayment, money } = require('./calc');

const CREATIVE_DEFAULTS = {
  marketRate: 0.07, // what a new 30-year investor loan roughly costs today; used for "rate savings"
  closingCosts: 3000, // title, recording, servicing setup
  expensePct: 0.21, // vacancy 5%, maintenance 8%, capital repairs 5%, management 3% of rent (taxes and insurance sit in the payment)
  minCashFlow: 200, // monthly cash flow most creative buyers want at least
};

const LOAN_TYPES = ['Conventional', 'FHA', 'VA', 'USDA', 'Other', 'Unknown'];

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function cleanCreative(input = {}) {
  const out = {};
  const nums = ['loanBalance', 'loanRate', 'loanPayment', 'arrears', 'sellerCash', 'noteAmount', 'noteRate', 'noteYears', 'balloonYears', 'yourFee', 'closingCosts', 'rent', 'value', 'loanYearsLeft'];
  for (const k of nums) if (input[k] !== undefined && input[k] !== '') out[k] = Math.max(0, num(input[k]));
  if (input.loanType !== undefined) out.loanType = LOAN_TYPES.includes(input.loanType) ? input.loanType : 'Unknown';
  if (input.lender !== undefined) out.lender = String(input.lender).slice(0, 80);
  return out;
}

function creativeAnalysis(raw = {}, defaults = {}) {
  const i = { ...defaults, ...cleanCreative(raw) };
  const value = num(i.value);
  const loanBalance = num(i.loanBalance);
  const loanRate = num(i.loanRate) / 100;
  const loanPayment = num(i.loanPayment); // the seller's full monthly payment incl. taxes and insurance (PITI)
  const arrears = num(i.arrears);
  const sellerCash = num(i.sellerCash);
  const noteAmount = num(i.noteAmount);
  const noteRate = num(i.noteRate) / 100;
  const noteYears = num(i.noteYears, 30) || 30;
  const balloonYears = num(i.balloonYears);
  const yourFee = num(i.yourFee);
  const closingCosts = num(i.closingCosts, CREATIVE_DEFAULTS.closingCosts);
  const rent = num(i.rent);

  const structure = loanBalance > 0 && noteAmount > 0 ? 'hybrid' : loanBalance > 0 ? 'subject-to' : noteAmount > 0 ? 'seller-finance' : 'none';

  // A seller note can be interest-only or amortizing; we assume amortizing over noteYears.
  const notePayment = noteAmount > 0 ? monthlyPayment(noteAmount, noteRate, noteYears) : 0;
  const totalPayment = loanPayment + notePayment;
  const expenses = rent * CREATIVE_DEFAULTS.expensePct;
  const cashFlow = rent - totalPayment - expenses;

  const entryFee = sellerCash + arrears + closingCosts + yourFee;
  const price = loanBalance + noteAmount + sellerCash; // what the seller is effectively paid
  const equity = value - loanBalance - noteAmount;
  const cashOnCash = entryFee > 0 ? (cashFlow * 12) / entryFee : null;

  // How much cheaper the inherited loan is than a new one for the same balance.
  const principalAndInterest = loanBalance > 0 && loanRate > 0 ? monthlyPayment(loanBalance, loanRate, num(i.loanYearsLeft, 30) || 30) : 0;
  const newLoanPI = loanBalance > 0 ? monthlyPayment(loanBalance, CREATIVE_DEFAULTS.marketRate, 30) : 0;
  const rateSavings = loanBalance > 0 && loanRate > 0 ? newLoanPI - principalAndInterest : 0;

  const flags = [];
  if (structure === 'none') flags.push({ level: 'bad', text: "Add the seller's loan balance, or the amount the seller will carry as a loan." });
  if (rent <= 0) flags.push({ level: 'bad', text: 'Add the monthly rent. Creative investors buy for cash flow.' });
  if (loanBalance > 0 && loanPayment <= 0) flags.push({ level: 'bad', text: "Add the seller's monthly payment, including taxes and insurance." });
  if (rent > 0 && totalPayment > 0 && cashFlow < 0) flags.push({ level: 'bad', text: `Rent doesn't cover the payments and costs: about ${money(-cashFlow)} short each month.` });
  else if (rent > 0 && totalPayment > 0 && cashFlow < CREATIVE_DEFAULTS.minCashFlow) flags.push({ level: 'warn', text: `Cash flow is about ${money(cashFlow)} a month. Most creative investors want at least ${money(CREATIVE_DEFAULTS.minCashFlow)}.` });
  if (value > 0 && equity < 0) flags.push({ level: 'warn', text: `More is owed than the house is worth (about ${money(-equity)} under water). Some investors still buy for cash flow, many won't.` });
  if (arrears > 0) flags.push({ level: 'info', text: `The seller is ${money(arrears)} behind. That gets paid at closing, so it's part of the investor's entry fee.` });
  if (rateSavings > 50) flags.push({ level: 'info', text: `The existing loan is at ${(loanRate * 100).toFixed(2)}%. That's about ${money(rateSavings)} a month cheaper than a new loan at ${(CREATIVE_DEFAULTS.marketRate * 100).toFixed(0)}%. This is the main selling point.` });
  if (balloonYears > 0) flags.push({ level: 'warn', text: `The seller loan has a balloon: the rest is due in ${balloonYears} year${balloonYears === 1 ? '' : 's'}. The investor must refinance or sell before then.` });
  if (i.loanType === 'VA') flags.push({ level: 'warn', text: "VA loan: the seller's VA benefit stays tied to this house until the loan is paid off. Explain this to the seller in writing." });
  if (loanBalance > 0) flags.push({ level: 'info', text: "The loan stays in the seller's name and has a due-on-sale clause: the lender can ask for full payment if it finds out. The seller must understand this in writing." });

  const verdict =
    flags.some((f) => f.level === 'bad')
      ? 'does-not-work'
      : cashFlow < CREATIVE_DEFAULTS.minCashFlow || (cashOnCash !== null && cashOnCash < 0.1) || (value > 0 && equity < 0)
        ? 'tight'
        : 'works';

  const r = Math.round;
  return {
    structure,
    inputs: { value, loanBalance, loanRate: loanRate * 100, loanPayment, arrears, sellerCash, noteAmount, noteRate: noteRate * 100, noteYears, balloonYears, yourFee, closingCosts, rent, loanType: i.loanType || 'Unknown', lender: i.lender || '' },
    price: r(price),
    entryFee: r(entryFee),
    notePayment: r(notePayment),
    totalPayment: r(totalPayment),
    expenses: r(expenses),
    cashFlow: r(cashFlow),
    equity: r(equity),
    cashOnCash: cashOnCash === null ? null : Math.round(cashOnCash * 1000) / 10,
    rateSavings: r(rateSavings),
    verdict,
    flags,
  };
}

module.exports = { creativeAnalysis, cleanCreative, CREATIVE_DEFAULTS, LOAN_TYPES };
