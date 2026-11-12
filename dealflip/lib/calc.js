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
  const buyerMaxPrice = arv * maoPct - repairs - titleAndLiens;

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
    flags.push({ level: 'bad', text: 'Enter an after-repair value (ARV) backed by recent comparable sales.' });
  }
  if (contractPrice > 0 && contractPrice > buyerMaxPrice) {
    flags.push({
      level: 'bad',
      text: `Your contract price is above what a 70%-rule investor would pay (${money(buyerMaxPrice)}). There is no room for a fee.`,
    });
  }
  if (buyerPrice > buyerMaxPrice && arv > 0) {
    flags.push({
      level: 'warn',
      text: `Asking your buyer for ${money(buyerPrice)} is ${money(buyerPrice - buyerMaxPrice)} over the 70% rule max (${money(buyerMaxPrice)}). Experienced cash buyers will likely pass.`,
    });
  }
  if (arv > 0 && buyerProfit < 0) {
    flags.push({ level: 'bad', text: `At this price the end buyer loses about ${money(-buyerProfit)}. Nobody informed will take it.` });
  } else if (arv > 0 && buyerMargin < 0.1) {
    flags.push({ level: 'warn', text: 'End buyer profit is under 10% of ARV, which is thin for a flip.' });
  }
  if (assignmentFee <= 0 && buyerPrice > 0) {
    flags.push({ level: 'bad', text: 'Buyer price is not above your contract price, so there is no assignment fee.' });
  }
  if (earnestMoney > 0) {
    flags.push({
      level: 'info',
      text: `You risk your ${money(earnestMoney)} earnest money if you cannot find a buyer and your contract has no exit (inspection or assignment contingency).`,
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

module.exports = { analyzeDeal, matchBuyer, money, DEFAULTS };
