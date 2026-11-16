'use strict';

// Deal math for a wholesale / contract-assignment deal.
//
// Terms:
//   ARV            after-repair value: what the house sells for once fixed up
//   contractPrice  what you agree to pay the seller (or the county)
//   buyerPrice     what your cash buyer pays to take over your contract
//   repairs        rehab budget the end buyer will spend
//   titleAndLiens  back taxes, liens, quiet-title action, title insurance gaps
//   buyerCostPct   end buyer's closing + holding + selling costs, as a share of ARV
//   maoPct         the "70% rule" percentage investors use for a max offer
//
// Every number is an input the user must verify. Nothing here is a guarantee.

const DEFAULTS = {
  maoPct: 0.7,
  buyerCostPct: 0.12,
  repairs: 0,
  titleAndLiens: 0,
  yourCosts: 0,
  earnestMoney: 0,
};

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round(n) {
  return Math.round(n);
}

function analyzeDeal(raw = {}) {
  const i = { ...DEFAULTS };
  for (const k of Object.keys(raw)) {
    if (raw[k] !== undefined && raw[k] !== '') i[k] = raw[k];
  }

  const arv = num(i.arv);
  const contractPrice = num(i.contractPrice);
  const buyerPrice = num(i.buyerPrice);
  const repairs = num(i.repairs);
  const titleAndLiens = num(i.titleAndLiens);
  const yourCosts = num(i.yourCosts);
  const earnestMoney = num(i.earnestMoney);
  const maoPct = num(i.maoPct, DEFAULTS.maoPct);
  const buyerCostPct = num(i.buyerCostPct, DEFAULTS.buyerCostPct);

  // Highest price an investor following the 70% rule would pay for this house.
  // Rounded to whole dollars so float noise (0.7 * 90000 = 62999.999...) can't trip the flags below.
  const buyerMaxPrice = Math.round(arv * maoPct - repairs - titleAndLiens);

  const assignmentFee = buyerPrice - contractPrice;
  const yourNet = assignmentFee - yourCosts;

  const buyerOtherCosts = arv * buyerCostPct;
  const buyerAllIn = buyerPrice + repairs + titleAndLiens + buyerOtherCosts;
  const buyerProfit = arv - buyerAllIn;
  const buyerMargin = arv > 0 ? buyerProfit / arv : 0;

  // The fee you could realistically ask, if the buyer pays no more than their max.
  const realisticFee = buyerMaxPrice - contractPrice;

  const flags = [];
  if (arv <= 0) {
    flags.push({ level: 'bad', text: 'Add what the house will be worth after repairs. Check recent sales of similar houses nearby.' });
  }
  if (contractPrice > 0 && contractPrice > buyerMaxPrice) {
    flags.push({
      level: 'bad',
      text: `Your price is higher than an investor would pay (up to ${money(buyerMaxPrice)}), so there's no room for your fee.`,
    });
  }
  if (buyerPrice > buyerMaxPrice && arv > 0) {
    flags.push({
      level: 'warn',
      text: `You're asking the investor ${money(buyerPrice - buyerMaxPrice)} more than they'd usually pay (up to ${money(buyerMaxPrice)}). Most will say no.`,
    });
  }
  if (arv > 0 && buyerProfit < 0) {
    flags.push({ level: 'bad', text: `The investor would lose about ${money(-buyerProfit)} at this price, so they won't buy.` });
  } else if (arv > 0 && buyerMargin < 0.1) {
    flags.push({ level: 'warn', text: "The investor's profit is under 10% of the value. That's thin for a flip." });
  }
  if (assignmentFee <= 0 && buyerPrice > 0) {
    flags.push({ level: 'bad', text: "The investor's price isn't higher than yours, so you'd make nothing." });
  }
  if (earnestMoney > 0) {
    flags.push({
      level: 'info',
      text: `Your ${money(earnestMoney)} deposit is only safe during the days you can cancel free. Find an investor before then.`,
    });
  }

  return {
    inputs: { arv, contractPrice, buyerPrice, repairs, titleAndLiens, yourCosts, earnestMoney, maoPct, buyerCostPct },
    buyerMaxPrice: round(buyerMaxPrice),
    assignmentFee: round(assignmentFee),
    yourNet: round(yourNet),
    realisticFee: round(Math.max(0, realisticFee)),
    buyerOtherCosts: round(buyerOtherCosts),
    buyerAllIn: round(buyerAllIn),
    buyerProfit: round(buyerProfit),
    buyerMargin: Math.round(buyerMargin * 1000) / 10,
    verdict: verdictFor(flags),
    flags,
  };
}

function verdictFor(flags) {
  if (flags.some((f) => f.level === 'bad')) return 'does-not-work';
  if (flags.some((f) => f.level === 'warn')) return 'tight';
  return 'works';
}

function money(n) {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
}

// Score how well a cash buyer fits a deal (0-100). Pure data match, no AI.
function matchBuyer(buyer, deal, askPrice) {
  let score = 0;
  const reasons = [];

  const sameState = buyer.states?.includes(deal.state);
  const inCounty = buyer.counties?.some((c) => c.toLowerCase() === String(deal.county || '').toLowerCase());
  if (inCounty) {
    score += 40;
    reasons.push(`buys in ${deal.county} County`);
  } else if (sameState) {
    score += 25;
    reasons.push(`buys in ${deal.state}`);
  }

  const price = num(askPrice, deal.askingPrice);
  if (price >= num(buyer.minPrice) && price <= num(buyer.maxPrice, Infinity)) {
    score += 30;
    reasons.push('price is in their range');
  }

  if (buyer.propertyTypes?.includes(deal.propertyType)) {
    score += 15;
    reasons.push(`buys ${deal.propertyType}`);
  }

  if (buyer.rehabLevels?.includes(deal.condition)) {
    score += 15;
    reasons.push(`takes ${deal.condition} rehabs`);
  }

  if (!buyer.proofOfFunds) {
    score -= 10;
    reasons.push('no proof of funds on file');
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

// ---------- Rental / BRRRR view, for buy-and-hold cash buyers ----------
//
// BRRRR = buy, rehab, rent, refinance, repeat. The buyer pays cash, fixes the
// house, rents it out, then refinances at a share of the after-repair value
// to pull their cash back out.

const RENTAL_DEFAULTS = {
  vacancyPct: 0.08,
  maintenancePct: 0.08,
  managementPct: 0.1,
  capexPct: 0.05,
  closingPct: 0.03, // buyer's purchase closing costs, share of price
  refiLtv: 0.75,
  refiRate: 0.075,
  refiYears: 30,
  refiCostPct: 0.03, // refinance closing costs, share of the new loan
};

// Rough starting rent when nothing better is known: 0.8% of ARV per month.
function estimateRent(arv) {
  return Math.round((num(arv) * 0.008) / 25) * 25;
}

function monthlyPayment(principal, annualRate, years) {
  const n = years * 12;
  const r = annualRate / 12;
  if (principal <= 0 || n <= 0) return 0;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

function rentalAnalysis(raw = {}) {
  const i = { ...RENTAL_DEFAULTS };
  for (const k of Object.keys(raw)) if (raw[k] !== undefined && raw[k] !== '') i[k] = raw[k];

  const arv = num(i.arv);
  const price = num(i.buyerPrice);
  const repairs = num(i.repairs) + num(i.titleAndLiens);
  const rent = num(i.rent, estimateRent(arv));
  const taxes = num(i.taxesYearly, arv * 0.015);
  const insurance = num(i.insuranceYearly, arv * 0.006);
  const pct = (k) => num(i[k], RENTAL_DEFAULTS[k]);

  const allIn = price + repairs + price * pct('closingPct');
  const grossYearly = rent * 12;
  const opexYearly =
    grossYearly * (pct('vacancyPct') + pct('maintenancePct') + pct('managementPct') + pct('capexPct')) + taxes + insurance;
  const noi = grossYearly - opexYearly;

  const loan = arv * pct('refiLtv');
  const payment = monthlyPayment(loan, pct('refiRate'), num(i.refiYears, RENTAL_DEFAULTS.refiYears));
  const refiCosts = loan * pct('refiCostPct');
  const cashLeftIn = allIn + refiCosts - loan; // negative = buyer pulls out more than they put in
  const cashFlowAfterRefi = noi / 12 - payment;

  const flags = [];
  if (arv <= 0) flags.push({ level: 'bad', text: 'Add the value after repairs to see rental numbers.' });
  if (rent <= 0) flags.push({ level: 'bad', text: 'Add the monthly rent.' });
  if (arv > 0 && rent > 0 && cashFlowAfterRefi < 0) {
    flags.push({ level: 'warn', text: `After refinancing, rent falls about ${money(-cashFlowAfterRefi)} a month short of the costs and loan.` });
  }
  if (allIn > 0 && rent / allIn < 0.01) {
    flags.push({ level: 'info', text: `Monthly rent is ${(Math.round((rent / allIn) * 1000) / 10)}% of the total cost. Rental investors usually want 1% or more.` });
  }
  if (cashLeftIn <= 0 && arv > 0) {
    flags.push({ level: 'info', text: "The refinance could pay back all of the investor's cash. Some lenders limit this, so check with one." });
  }

  const rentalVerdict = flags.some((f) => f.level === 'bad')
    ? 'does-not-work'
    : cashFlowAfterRefi < 100 || (allIn > 0 && rent / allIn < 0.008)
      ? 'tight'
      : 'works';

  const round = Math.round;
  return {
    inputs: { arv, buyerPrice: price, rent, taxesYearly: round(taxes), insuranceYearly: round(insurance) },
    rentIsEstimate: raw.rent === undefined || raw.rent === '',
    allIn: round(allIn),
    grossYearly: round(grossYearly),
    opexYearly: round(opexYearly),
    noi: round(noi),
    capRate: allIn > 0 ? Math.round((noi / allIn) * 1000) / 10 : 0,
    cashFlowNoLoan: round(noi / 12),
    onePercent: allIn > 0 ? Math.round((rent / allIn) * 1000) / 10 : 0,
    refiLoan: round(loan),
    refiPayment: round(payment),
    cashLeftIn: round(cashLeftIn),
    cashFlowAfterRefi: round(cashFlowAfterRefi),
    cashOnCash: cashLeftIn > 0 ? Math.round(((cashFlowAfterRefi * 12) / cashLeftIn) * 1000) / 10 : null,
    verdict: rentalVerdict,
    flags,
  };
}

module.exports = { analyzeDeal, matchBuyer, rentalAnalysis, estimateRent, monthlyPayment, money, DEFAULTS, RENTAL_DEFAULTS };
