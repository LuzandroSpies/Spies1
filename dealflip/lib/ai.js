'use strict';

// AI helpers. Uses Claude when credentials are available (ANTHROPIC_API_KEY,
// ANTHROPIC_AUTH_TOKEN, or an `ant auth login` profile). Without credentials,
// every helper returns a plain template so the app still works end to end.
const Anthropic = require('@anthropic-ai/sdk');
const { money } = require('./calc');

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

async function draftOffer(deal, terms, analysis) {
  const prompt = `${describeDeal(deal, analysis)}

Offer terms chosen by the user:
  Price ${money(terms.price)}, close in ${terms.closingDays} days, earnest money ${money(terms.earnestMoney)},
  inspection period ${terms.inspectionDays} days, seller credits ${money(terms.sellerCredits || 0)},
  buyer named as "${terms.buyerName || '[Your name]'} and/or assigns": ${terms.assignable ? 'yes' : 'no'}.

Draft a short, friendly letter of intent (LOI) to the seller with these terms, in plain English.
Start with a one-line note to the user (not part of the letter) if the sale type means an offer
like this may not apply (for example, a county tax deed auction is bid, not negotiated).
End the letter with a line saying it is non-binding until a written purchase agreement is signed.
Under 300 words.`;
  try {
    return { ai: true, text: await ask(prompt, { effort: 'low' }) };
  } catch (err) {
    return { ai: false, note: friendly(err), text: fallbackOffer(deal, terms) };
  }
}

async function draftOutreach(deal, buyer, price, analysis, rental = null) {
  const prompt = `${describeDeal(deal, analysis)}

Cash buyer: ${buyer.name}. Buy box: ${buyer.states.join(', ')} (${(buyer.counties || []).join(', ')}),
${money(buyer.minPrice)}-${money(buyer.maxPrice)}, ${buyer.propertyTypes.join('/')}, ${buyer.rehabLevels.join('/')} rehab.

${rental ? `This buyer keeps rentals. Rental estimate at that price: rent ${money(rental.inputs.rent)}/mo (from ${rental.rentSource}), cap rate ${rental.capRate}%, cash flow with no loan ${money(rental.cashFlowNoLoan)}/mo, after refinancing ${money(rental.cashFlowAfterRefi)}/mo. Mention these as estimates.\n` : ''}Write a short email to this buyer offering the deal at ${money(price)}. Include a subject line.
Be honest: say the user holds a purchase contract (not the deed), that the price is for an
assignment of contract, state the ARV and repair numbers as estimates, and invite them to verify.
Under 180 words.`;
  try {
    return { ai: true, text: await ask(prompt, { effort: 'low' }) };
  } catch (err) {
    return { ai: false, note: friendly(err), text: fallbackOutreach(deal, buyer, price, analysis, rental) };
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

function fallbackOffer(deal, t) {
  const buyer = `${t.buyerName || '[Your name]'}${t.assignable ? ' and/or assigns' : ''}`;
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

function fallbackOutreach(deal, buyer, price, a, rental = null) {
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
