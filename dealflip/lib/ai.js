'use strict';

// AI helpers. Uses Claude when credentials are available (ANTHROPIC_API_KEY,
// ANTHROPIC_AUTH_TOKEN, or an `ant auth login` profile). Without credentials,
// every helper returns a plain template so the app still works end to end.
const Anthropic = require('@anthropic-ai/sdk');
const { money } = require('./calc');

function describeCreative(c) {
  if (!c) return '';
  return [
    '',
    `Creative terms (${c.structure}):`,
    c.inputs.loanBalance ? `  Take over the seller's ${c.inputs.loanType} loan: balance ${money(c.inputs.loanBalance)} at ${c.inputs.loanRate}%, payment ${money(c.inputs.loanPayment)}/mo incl. taxes and insurance${c.inputs.arrears ? `, ${money(c.inputs.arrears)} behind` : ''}` : null,
    c.inputs.noteAmount ? `  Seller carries ${money(c.inputs.noteAmount)} at ${c.inputs.noteRate}% over ${c.inputs.noteYears} years (${money(c.notePayment)}/mo)${c.inputs.balloonYears ? `, balloon in ${c.inputs.balloonYears} years` : ''}` : null,
    `  Cash to seller ${money(c.inputs.sellerCash)}; investor's entry fee ${money(c.entryFee)} (includes the user's fee ${money(c.inputs.yourFee)})`,
    `  Rent ${money(c.inputs.rent)}/mo; total payment ${money(c.totalPayment)}/mo; cash flow ${money(c.cashFlow)}/mo; equity ${money(c.equity)}`,
    `  Flags: ${c.flags.map((f) => f.text).join(' | ') || 'none'}`,
  ].filter((l) => l !== null).join('\n');
}

const MODEL = process.env.DEALFLIP_MODEL || 'claude-opus-5-5';

const SYSTEM = `You help a beginner real estate wholesaler evaluate and work deals honestly.
Ground every number in the deal data you are given; never invent comps, buyers, or guarantees.
Be direct about risks, especially for tax deed and tax lien properties: redemption periods,
auction rules (a county auction usually cannot be "put under contract" or assigned),
title insurability and quiet-title costs, occupancy, unseen condition, and state rules on
wholesaling (licensing, disclosure, and marketing a property you do not own).
Do not give legal advice; tell the user when an attorney or title company must confirm something.
Write in plain English for someone new to real estate: avoid jargon like ARV or comps, or explain it in a few words. Use short sections and bullet points.`;

let client = null;
let clientError = null;
function getClient() {
  if (client || clientError) return client;
  try {
    client = new Anthropic();
  } catch (err) {
    clientError = err;
  }
  return client;
}

function aiAvailable() {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return true;
  const home = process.env.HOME || '';
  return require('fs').existsSync(require('path').join(home, '.config', 'anthropic'));
}

async function ask(prompt, { effort = 'medium' } = {}) {
  const c = getClient();
  if (!c || !aiAvailable()) throw new Error('No Claude API key set');

  const response = await c.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort },
    // If Claude declines on a safety classifier, the API retries on a fallback model.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [{ role: 'user', content: prompt }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude declined this request.');
  }
  return response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

function describeDeal(deal, analysis) {
  const a = analysis;
  return [
    `Property: ${deal.address}, ${deal.city}, ${deal.county} County, ${deal.state}`,
    `Type: ${deal.propertyType}, ${deal.beds} bd / ${deal.baths} ba, ${deal.sqft} sqft, built ${deal.yearBuilt}`,
    `Sale type: ${deal.saleType}${deal.saleDate ? `, sale date ${deal.saleDate}` : ''}`,
    `Listed price: ${money(deal.askingPrice)}; listed estimated value: ${money(deal.estimatedValue)}`,
    `Condition: ${deal.condition}; notes: ${deal.notes || 'none'}`,
    '',
    'User-entered numbers:',
    `  ARV ${money(a.inputs.arv)}, repairs ${money(a.inputs.repairs)}, title/liens ${money(a.inputs.titleAndLiens)}`,
    `  Contract price ${money(a.inputs.contractPrice)}, price asked of cash buyer ${money(a.inputs.buyerPrice)}`,
    `  Your marketing/closing costs ${money(a.inputs.yourCosts)}, earnest money ${money(a.inputs.earnestMoney)}`,
    '',
    'Calculated:',
    `  70%-rule buyer max ${money(a.buyerMaxPrice)}; assignment fee ${money(a.assignmentFee)}; your net ${money(a.yourNet)}`,
    `  End buyer all-in ${money(a.buyerAllIn)}; end buyer profit ${money(a.buyerProfit)} (${a.buyerMargin}% of ARV)`,
    `  Flags: ${a.flags.map((f) => f.text).join(' | ') || 'none'}`,
  ].join('\n');
}

async function reviewDeal(deal, analysis) {
  const prompt = `${describeDeal(deal, analysis)}

Review this deal. Give:
1. A one-line verdict (works / tight / does not work) and why.
2. A realistic assignment fee range, explaining what a cash buyer would actually pay.
3. The biggest risks for this specific sale type, ranked.
4. A due-diligence checklist of what to verify before signing anything or putting down earnest money.
Keep it under 400 words.`;
  try {
    return { ai: true, text: await ask(prompt) };
  } catch (err) {
    return { ai: false, note: friendly(err), text: fallbackReview(deal, analysis) };
  }
}

async function draftOffer(deal, terms, analysis, creative = null) {
  const prompt = `${describeDeal(deal, analysis)}${describeCreative(creative)}

Offer terms chosen by the user:
  Price ${money(terms.price)}, close in ${terms.closingDays} days, earnest money ${money(terms.earnestMoney)},
  inspection period ${terms.inspectionDays} days, seller credits ${money(terms.sellerCredits || 0)},
  buyer named as "${terms.buyerName || '[Your name]'} and/or assigns": ${terms.assignable ? 'yes' : 'no'}.

${creative ? `This is a creative offer: use the creative terms above instead of a cash price. Explain plainly that the
loan stays in the seller's name and the lender's due-on-sale clause still applies, and suggest the seller
get independent advice. Never pressure the seller or promise the lender won't call the loan.
` : ''}Draft a short, friendly letter of intent (LOI) to the seller with these terms, in plain English.
Start with a one-line note to the user (not part of the letter) if the sale type means an offer
like this may not apply (for example, a county tax deed auction is bid, not negotiated).
End the letter with a line saying it is non-binding until a written purchase agreement is signed.
Under 300 words.`;
  try {
    return { ai: true, text: await ask(prompt, { effort: 'low' }) };
  } catch (err) {
    return { ai: false, note: friendly(err), text: fallbackOffer(deal, terms, creative) };
  }
}

async function draftOutreach(deal, buyer, price, analysis, rental = null, creative = null) {
  const prompt = `${describeDeal(deal, analysis)}${describeCreative(creative)}

Investor: ${buyer.name}. Buy box: ${(buyer.states || []).join(', ')} (${(buyer.counties || []).join(', ')}),
${money(buyer.minPrice)}-${buyer.maxPrice ? money(buyer.maxPrice) : 'any'}, ${(buyer.propertyTypes || []).join('/') || 'any type'}, ${(buyer.rehabLevels || []).join('/') || 'any'} rehab${buyer.strategies?.length ? `, does: ${buyer.strategies.join('/')}` : ''}${buyer.maxEntryFee ? `, max entry fee ${money(buyer.maxEntryFee)}` : ''}${buyer.minCashFlow ? `, wants ${money(buyer.minCashFlow)}+/mo cash flow` : ''}.

${rental ? `This buyer keeps rentals. Rental estimate at that price: rent ${money(rental.inputs.rent)}/mo (from ${rental.rentSource}), cap rate ${rental.capRate}%, cash flow with no loan ${money(rental.cashFlowNoLoan)}/mo, after refinancing ${money(rental.cashFlowAfterRefi)}/mo. Mention these as estimates.\n` : ''}${creative ? `This buyer does creative deals. Lead with the entry fee, the monthly payment, the interest rate, rent and cash flow, not a cash price.
` : ''}Write a short email to this buyer offering the deal${creative ? ' on these creative terms' : ` at ${money(price)}`}. Include a subject line.
Be honest: say the user holds a purchase contract (not the deed), that the price is for an
assignment of contract, state the ARV and repair numbers as estimates, and invite them to verify.
Under 180 words.`;
  try {
    return { ai: true, text: await ask(prompt, { effort: 'low' }) };
  } catch (err) {
    return { ai: false, note: friendly(err), text: fallbackOutreach(deal, buyer, price, analysis, rental, creative) };
  }
}

function friendly(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'Claude API key was rejected';
  if (err instanceof Anthropic.RateLimitError) return 'Claude rate limit hit, try again shortly';
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the Claude API';
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status ?? ''}`.trim();
  return err.message;
}

function fallbackReview(deal, a) {
  const lines = [];
  const verdictText = { works: 'Works on paper', tight: 'Tight', 'does-not-work': 'Does not work as entered' }[a.verdict];
  lines.push(`Verdict: ${verdictText}.`);
  lines.push('');
  lines.push(`An investor would usually pay at most about ${money(a.buyerMaxPrice)}.`);
  lines.push(`At your price, that leaves you a fee of about ${money(a.realisticFee)}.`);
  if (a.flags.length) {
    lines.push('');
    lines.push('Flags:');
    for (const f of a.flags) lines.push(`- ${f.text}`);
  }
  lines.push('');
  lines.push('Verify before signing:');
  lines.push('- Find 3-5 similar houses that sold nearby in the last 6 months to confirm the value after repairs.');
  lines.push('- See the inside or get a contractor walkthrough before trusting the repair number.');
  lines.push('- Order a title search; confirm the seller can deliver clear, insurable title.');
  lines.push('- Confirm the contract can be assigned and that your state allows it without a license.');
  if (/tax/i.test(deal.saleType)) {
    lines.push('- Tax sale: read the county rules. Auctions usually need full payment within days, cannot be assigned, and may have a redemption period.');
  }
  lines.push('');
  lines.push('(Template review. Add Claude credentials for a full AI review.)');
  return lines.join('\n');
}

function fallbackCreativeOffer(deal, t, c, buyer) {
  const i = c.inputs;
  return [
    `Re: ${deal.address}, ${deal.city}, ${deal.state}`,
    '',
    'Dear Owner,',
    '',
    `Thank you for talking with me. ${buyer} would like to buy your home at ${deal.address} on these terms:`,
    '',
    i.loanBalance ? `- I take over your monthly mortgage payment of about ${money(i.loanPayment)}, starting with the first payment after closing. The loan (about ${money(i.loanBalance)}) stays in place.` : null,
    i.arrears ? `- I bring your loan current by paying the ${money(i.arrears)} you're behind, at closing.` : null,
    i.noteAmount ? `- You carry a loan to me of ${money(i.noteAmount)} at ${i.noteRate}% interest. I pay you about ${money(c.notePayment)} a month${i.balloonYears ? `, and pay off the rest within ${i.balloonYears} years` : ''}.` : null,
    i.sellerCash ? `- You receive ${money(i.sellerCash)} in cash at closing.` : null,
    `- Closing at a title company within ${t.closingDays} days, with ${t.inspectionDays} days for me to review everything first.`,
    '',
    i.loanBalance
      ? "Please know: your loan would stay in your name, and the lender can ask for the full balance because the home was sold (a \"due-on-sale\" clause). I'll make every payment through a loan servicing company so you can always check them. I'd encourage you to talk this over with an attorney or someone you trust before deciding."
      : 'Please talk this over with an attorney or someone you trust before deciding.',
    '',
    'This letter is non-binding until we both sign a written purchase agreement.',
    '',
    'Sincerely,',
    t.buyerName || '[Your name]',
  ]
    .filter((l) => l !== null)
    .join('\n');
}

function fallbackCreativeOutreach(deal, buyer, c) {
  const i = c.inputs;
  const kind = { 'subject-to': 'Subject-to', 'seller-finance': 'Seller finance', hybrid: 'Subject-to + seller finance' }[c.structure] || 'Creative';
  return [
    `Subject: ${kind} deal in ${deal.city}, ${deal.state} - ${money(c.entryFee)} entry, ${money(c.cashFlow)}/mo cash flow`,
    '',
    `Hi ${buyer.name.replace(/^Sample Buyer: /, '')},`,
    '',
    `I have ${deal.address}, ${deal.city} under contract on creative terms and am offering an assignment of the contract:`,
    '',
    i.loanBalance ? `- Existing ${i.loanType} loan: ${money(i.loanBalance)} at ${i.loanRate}%, ${money(i.loanPayment)}/mo including taxes and insurance` : null,
    i.noteAmount ? `- Seller carries ${money(i.noteAmount)} at ${i.noteRate}% (${money(c.notePayment)}/mo)${i.balloonYears ? `, balloon in ${i.balloonYears} years` : ''}` : null,
    `- Entry fee: ${money(c.entryFee)} (cash to seller, ${i.arrears ? 'arrears, ' : ''}closing costs and my fee)`,
    `- Rent: about ${money(i.rent)}/mo; estimated cash flow ${money(c.cashFlow)}/mo after payments and costs`,
    `- Estimated equity: ${money(c.equity)}`,
    '',
    'All figures are estimates; I can send the loan statement, seller disclosures and the contract for you to verify.',
    '',
    'Thanks,',
    '[Your name]',
  ]
    .filter((l) => l !== null)
    .join('\n');
}

function fallbackOffer(deal, t, c = null) {
  const buyer = `${t.buyerName || '[Your name]'}${t.assignable ? ' and/or assigns' : ''}`;
  if (c) return fallbackCreativeOffer(deal, t, c, buyer);
  return [
    /tax deed|tax lien/i.test(deal.saleType)
      ? 'Note: county tax sales are usually auctions you bid on, not offers you negotiate. Use this letter only if you are dealing directly with the owner before the sale.\n'
      : null,
    `Re: ${deal.address}, ${deal.city}, ${deal.state}`,
    '',
    'Dear Owner,',
    '',
    `${buyer} would like to buy your property at ${deal.address} on these terms:`,
    '',
    `- Purchase price: ${money(t.price)}, cash`,
    `- Earnest money: ${money(t.earnestMoney)}, held by a title company`,
    `- Inspection period: ${t.inspectionDays} days`,
    `- Closing: within ${t.closingDays} days of a signed agreement`,
    t.sellerCredits ? `- Seller credit at closing: ${money(t.sellerCredits)}` : null,
    '- Property sold as-is; buyer pays standard buyer closing costs',
    '',
    'This letter is non-binding until both parties sign a written purchase agreement.',
    '',
    'Sincerely,',
    t.buyerName || '[Your name]',
  ]
    .filter((l) => l !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function fallbackOutreach(deal, buyer, price, a, rental = null, c = null) {
  if (c) return fallbackCreativeOutreach(deal, buyer, c);
  return [
    `Subject: ${deal.city}, ${deal.state} ${deal.propertyType} under contract - ${money(price)}`,
    '',
    `Hi ${buyer.name.replace(/^Sample Buyer: /, '')},`,
    '',
    `I have ${deal.address}, ${deal.city} (${deal.beds} bd / ${deal.baths} ba, ${deal.sqft} sqft) under a purchase contract and am offering an assignment of that contract for ${money(price)}.`,
    '',
    `- Estimated ARV: ${money(a.inputs.arv)} (please verify with your own comps)`,
    `- Estimated repairs: ${money(a.inputs.repairs)} (${deal.condition} rehab)`,
    `- Sale type: ${deal.saleType}`,
    ...(rental
      ? [`- As a rental: about ${money(rental.inputs.rent)}/mo rent, ${rental.capRate}% cap rate, ${money(rental.cashFlowNoLoan)}/mo cash flow before any loan (estimates)`]
      : []),
    '',
    'Happy to share photos and the contract. Let me know if you want to walk it.',
    '',
    'Thanks,',
    '[Your name]',
  ].join('\n');
}

module.exports = { aiAvailable, reviewDeal, draftOffer, draftOutreach, MODEL };
