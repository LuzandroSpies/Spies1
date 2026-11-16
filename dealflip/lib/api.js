'use strict';

// Every DealFlip API route in one place. The Express server and the in-browser
// preview both call this, so they can't drift apart.
const { analyzeDeal, matchBuyer, rentalAnalysis, estimateRent } = require('./calc');
const { creativeAnalysis, cleanCreative } = require('./creative');
const contracts = require('./contracts');
const pipeline = require('./pipeline');
const { importCsv } = require('./importer');
const checklist = require('./checklist');
const { cleanSource } = require('./sources');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const DEAL_FIELDS = {
  address: 'string', city: 'string', county: 'string', state: 'string', zip: 'string', propertyType: 'string',
  beds: 'number', baths: 'number', sqft: 'number', yearBuilt: 'number', saleType: 'string', parcelId: 'string',
  ownerName: 'string', askingPrice: 'number', estimatedValue: 'number', estimatedRepairs: 'number',
  condition: 'string', titleAndLiens: 'number', notes: 'string', saleDate: 'string', source: 'string',
  estimatedRent: 'number',
};
const BUYER_FIELDS = {
  name: 'string', contact: 'string', states: 'list', counties: 'list', minPrice: 'number',
  maxPrice: 'number', propertyTypes: 'list', rehabLevels: 'list', proofOfFunds: 'boolean', notes: 'string',
  phone: 'string', strategies: 'list', closeDays: 'number', maxEntryFee: 'number', minCashFlow: 'number',
};

// Keep only known fields and coerce their types, so stored records stay clean.
function pick(body, fields) {
  const out = {};
  for (const [k, type] of Object.entries(fields)) {
    const v = body?.[k];
    if (v === undefined || v === null) continue;
    if (type === 'number') out[k] = Number(v) || 0;
    else if (type === 'boolean') out[k] = v === true || v === 'true' || v === 'on';
    else if (type === 'list') out[k] = (Array.isArray(v) ? v : String(v).split(',')).map((s) => String(s).trim()).filter(Boolean);
    else out[k] = String(v).slice(0, 2000);
  }
  return out;
}

// If no buyer price is given, assume the most a 70%-rule investor would pay.
function analysisFor(deal, inputs = {}) {
  const base = {
    arv: deal.estimatedValue,
    contractPrice: deal.askingPrice,
    repairs: deal.estimatedRepairs,
    titleAndLiens: deal.titleAndLiens,
    ...inputs,
  };
  if (!Number(base.buyerPrice)) base.buyerPrice = Math.max(0, analyzeDeal(base).buyerMaxPrice);
  return analyzeDeal(base);
}

function contractTerms(deal, t = {}) {
  return {
    price: Number(t.price) || deal.askingPrice,
    closingDays: Number(t.closingDays) || 30,
    earnestMoney: Number(t.earnestMoney) || 0,
    inspectionDays: Number(t.inspectionDays) || 10,
    sellerCredits: Number(t.sellerCredits) || 0,
    assigneeDeposit: Number(t.assigneeDeposit) || 0,
    assignable: t.assignable !== false,
    buyerName: String(t.buyerName || '').slice(0, 100),
    sellerName: String(t.sellerName || '').slice(0, 100),
    titleCompany: String(t.titleCompany || '').slice(0, 100),
  };
}

const DEFAULT_GOAL = { amount: 30000, deadline: '2026-11-30' };

function withQuick(d) {
  const out = { ...d, quick: analysisFor(d) };
  if (d.mode === 'creative') out.quickCreative = creativeFor(d);
  return out;
}

// What investors can send through the public sign-up form.
const SIGNUP_FIELDS = {
  name: 'string', contact: 'string', phone: 'string', states: 'list', counties: 'list', minPrice: 'number',
  maxPrice: 'number', propertyTypes: 'list', rehabLevels: 'list', strategies: 'list', proofOfFunds: 'boolean',
  closeDays: 'number', notes: 'string', maxEntryFee: 'number', minCashFlow: 'number',
};

// Creative terms: saved ones on the deal, overridden by what the page sends.
function creativeFor(deal, creative = {}) {
  const saved = deal.creative || {};
  const value = deal.estimatedValue || 0;
  return creativeAnalysis({
    value,
    rent: deal.estimatedRent || estimateRent(value),
    ...saved,
    ...cleanCreative(creative),
  });
}
const wantsCreative = (deal, body) => (body.mode || deal.mode) === 'creative';

function rentalFor(deal, inputs = {}, rental = {}) {
  const a = analysisFor(deal, inputs);
  const r = rentalAnalysis({
    arv: a.inputs.arv,
    buyerPrice: a.inputs.buyerPrice,
    repairs: a.inputs.repairs,
    titleAndLiens: a.inputs.titleAndLiens,
    rent: deal.estimatedRent || undefined,
    ...rental,
  });
  const userRent = rental.rent !== undefined && rental.rent !== '';
  r.rentSource = userRent
    ? 'you'
    : deal.estimatedRent && deal.comps?.rent?.estimate === deal.estimatedRent
      ? 'RentCast'
      : deal.estimatedRent
        ? 'the deal'
        : 'rough guess (0.8% of ARV)';
  delete r.rentIsEstimate;
  return r;
}

// deps.comps(deal) and deps.fetchCsv(url) are only provided by the server;
// the in-browser preview can't call outside services.
function createApi({ store, ai, now = () => new Date(), comps = null, fetchCsv = null }) {
  const today = () => pipeline.todayIso(now());
  const dealOr404 = (id) => store.get('deals', id) || (() => { throw new HttpError(404, 'Deal not found'); })();
  const buyerOr404 = (id) => store.get('buyers', id) || (() => { throw new HttpError(404, 'Buyer not found'); })();
  const goal = () => ({ ...DEFAULT_GOAL, ...(store.getSettings().goal || {}) });

  let handleRunAll;

  function importInto(csv, defaults) {
    const result = importCsv(csv, defaults, store.list('deals'));
    const added = store.addMany('deals', result.deals.map((d) => pick(d, DEAL_FIELDS)));
    const counts = { works: 0, tight: 0, 'does-not-work': 0, 'needs-value': 0 };
    for (const d of added) counts[d.estimatedValue > 0 ? analysisFor(d).verdict : 'needs-value']++;
    return { added: added.length, counts, skipped: result.skipped.slice(0, 50), skippedCount: result.skipped.length, columns: result.columns, source: defaults.source || 'Import' };
  }

  async function runSource(sourceId) {
    if (!fetchCsv) throw new HttpError(501, 'Automatic pulls run in the full app once it is online.');
    const settings = store.getSettings();
    const src = (settings.sources || []).find((x) => x.id === sourceId);
    if (!src) throw new HttpError(404, 'List not found');
    let lastResult;
    try {
      const csv = await fetchCsv(src.url);
      const r = importInto(csv, { saleType: src.saleType, county: src.county, state: src.state, city: src.city, source: src.name, repairPct: src.repairPct });
      lastResult = { ok: true, added: r.added, counts: r.counts, skippedCount: r.skippedCount };
    } catch (err) {
      lastResult = { ok: false, error: err.message };
    }
    const fresh = store.getSettings();
    store.setSettings({
      ...fresh,
      sources: (fresh.sources || []).map((x) => (x.id === sourceId ? { ...x, lastRun: now().toISOString(), lastResult } : x)),
    });
    return { ...src, lastRun: now().toISOString(), lastResult };
  }

  // Pull every saved list; the server calls this once a day.
  handleRunAll = async () => {
    const out = [];
    for (const src of store.getSettings().sources || []) out.push(await runSource(src.id).catch((e) => ({ id: src.id, lastResult: { ok: false, error: e.message } })));
    return out;
  };

  // handle('POST', '/api/deals/d1/analyze', body, query) -> JSON-able result
  const handle = async function handle(method, path, body = {}, query = {}) {
    const p = path.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    const route = `${method} ${p.map((seg, i) => (i === 1 && ['deals', 'buyers', 'sources'].includes(p[0]) && seg !== 'import' ? ':id' : seg)).join('/')}`;
    const id = p[1];

    switch (route) {
      case 'GET status':
        return { ai: ai.aiAvailable(), model: ai.MODEL, today: today(), comps: Boolean(comps), autoPull: Boolean(fetchCsv) };

      case 'GET deals': {
        let deals = store.list('deals');
        if (query.saleType) deals = deals.filter((d) => d.saleType === query.saleType);
        if (query.state) deals = deals.filter((d) => d.state === query.state);
        if (query.maxPrice) deals = deals.filter((d) => d.askingPrice <= Number(query.maxPrice));
        if (query.source) deals = deals.filter((d) => (d.source || 'Sample') === query.source);
        let out = deals.map(withQuick);
        if (query.verdict) out = out.filter((d) => d.quick.verdict === query.verdict && d.estimatedValue > 0);
        return out;
      }
      case 'POST deals': {
        const deal = pick(body, DEAL_FIELDS);
        if (!deal.address || !deal.askingPrice) throw new HttpError(400, 'Address and price are required');
        return store.add('deals', deal);
      }
      case 'POST deals/import': {
        const csv = String(body.csv || '');
        if (!csv.trim()) throw new HttpError(400, 'The file is empty');
        if (csv.length > 5_000_000) throw new HttpError(413, 'File is too large (5 MB max)');
        const defaults = pick(body.defaults || {}, { saleType: 'string', county: 'string', state: 'string', city: 'string', source: 'string' });
        defaults.repairPct = Number(body.defaults?.repairPct ?? 0.2);
        return importInto(csv, defaults);
      }
      case 'GET deals/:id':
        return dealOr404(id);
      case 'DELETE deals/:id':
        return { deleted: store.remove('deals', id) };
      case 'PATCH deals/:id/pipeline': {
        const deal = dealOr404(id);
        let next;
        try {
          next = pipeline.cleanPipeline(body, deal.pipeline || {});
        } catch (err) {
          throw new HttpError(400, err.message);
        }
        if (next.buyerId && !store.get('buyers', next.buyerId)) throw new HttpError(400, 'Unknown buyer');
        return store.update('deals', id, { pipeline: next });
      }
      case 'POST deals/:id/analyze':
        return analysisFor(dealOr404(id), body);
      // Quick calculator: numbers only, no deal needed.
      case 'POST calc/cash': {
        const a = analyzeDeal({
          arv: body.arv,
          repairs: body.repairs,
          titleAndLiens: body.titleAndLiens,
          contractPrice: body.askingPrice || 0,
          buyerPrice: 0,
        });
        const fee = Math.max(0, Number(body.fee) || 0);
        const askingPrice = Number(body.askingPrice) || 0;
        return {
          investorMax: a.buyerMaxPrice,
          maxOffer: a.buyerMaxPrice - fee,
          feeAtAsking: askingPrice ? a.buyerMaxPrice - askingPrice : null,
          askingPrice,
          fee,
          hasValue: Number(body.arv) > 0,
        };
      }
      case 'POST calc/creative': {
        const c = creativeAnalysis(body.creative || {});
        // Work backwards from the investor's cash limit to the most cash you can offer the seller.
        const maxEntry = Number(body.maxEntryFee) || 0;
        const i = c.inputs;
        const maxSellerCash = maxEntry ? maxEntry - i.arrears - i.closingCosts - i.yourFee : null;
        return { ...c, maxEntryFee: maxEntry, maxSellerCash };
      }
      case 'POST deals/:id/creative':
        return creativeFor(dealOr404(id), body.creative);
      // Save how the investor buys (cash or creative) and the seller's loan details.
      case 'PUT deals/:id/creative': {
        const deal = dealOr404(id);
        const patch = {};
        if (body.mode !== undefined) {
          if (!['cash', 'creative'].includes(body.mode)) throw new HttpError(400, 'Mode must be cash or creative');
          patch.mode = body.mode;
        }
        if (body.creative !== undefined) patch.creative = { ...(deal.creative || {}), ...cleanCreative(body.creative) };
        return store.update('deals', id, patch);
      }
      case 'POST deals/:id/rental':
        return rentalFor(dealOr404(id), body.inputs, body.rental);
      case 'POST deals/:id/comps': {
        const deal = dealOr404(id);
        if (!comps) throw new HttpError(501, 'Value checks run in the full app once it is online with a RentCast key.');
        let result;
        try {
          result = await comps(deal);
        } catch (err) {
          throw new HttpError(err.status || 502, err.message);
        }
        const patch = { comps: result };
        if (result.rent?.estimate && !deal.estimatedRent) patch.estimatedRent = result.rent.estimate;
        return store.update('deals', id, patch);
      }
      case 'POST deals/:id/buyers': {
        const deal = dealOr404(id);
        const price = Number(body.price) || deal.askingPrice;
        const creative = wantsCreative(deal, body) ? creativeFor(deal, body.creative) : null;
        return store
          .list('buyers')
          .map((b) => ({ buyer: b, ...matchBuyer(b, deal, price, creative) }))
          .filter((m) => m.score > 0)
          .sort((x, y) => y.score - x.score);
      }
      case 'POST deals/:id/ai/review': {
        const deal = dealOr404(id);
        return ai.reviewDeal(deal, analysisFor(deal, body.inputs));
      }
      case 'POST deals/:id/ai/offer': {
        const deal = dealOr404(id);
        const creative = wantsCreative(deal, body) ? creativeFor(deal, body.creative) : null;
        return ai.draftOffer(deal, contractTerms(deal, body.terms), analysisFor(deal, body.inputs), creative);
      }
      case 'POST deals/:id/ai/outreach': {
        const deal = dealOr404(id);
        const buyer = buyerOr404(body.buyerId);
        const a = analysisFor(deal, body.inputs);
        const price = Number(body.price) || a.inputs.buyerPrice || a.buyerMaxPrice;
        const rental = buyer.strategies?.includes('rental') ? rentalFor(deal, { ...body.inputs, buyerPrice: price }, body.rental) : null;
        const creative = wantsCreative(deal, body) ? creativeFor(deal, body.creative) : null;
        return ai.draftOutreach(deal, buyer, price, a, creative ? null : rental, creative);
      }
      // Contract drafts are fixed templates filled from the deal, not AI-written.
      case 'POST deals/:id/contracts/purchase': {
        const deal = dealOr404(id);
        if (wantsCreative(deal, body)) return { text: contracts.creativePurchaseAgreement(deal, contractTerms(deal, body.terms), creativeFor(deal, body.creative)) };
        return { text: contracts.purchaseAgreement(deal, contractTerms(deal, body.terms)) };
      }
      case 'POST deals/:id/contracts/assignment': {
        const deal = dealOr404(id);
        const buyer = buyerOr404(body.buyerId);
        if (wantsCreative(deal, body)) return { text: contracts.creativeAssignmentAgreement(deal, contractTerms(deal, body.terms), buyer, creativeFor(deal, body.creative)) };
        const a = analysisFor(deal, body.inputs);
        return {
          text: contracts.assignmentAgreement(deal, contractTerms(deal, body.terms), buyer, {
            contractPrice: a.inputs.contractPrice,
            buyerPrice: a.inputs.buyerPrice,
          }),
        };
      }

      case 'POST join': {
        const b = pick(body, SIGNUP_FIELDS);
        if (!b.name || !(b.contact || b.phone)) throw new HttpError(400, 'Please add your name and an email or phone number.');
        if (!b.states?.length) throw new HttpError(400, 'Please add at least one state you buy in.');
        const signups = store.list('buyers').filter((x) => x.signup);
        if (signups.length >= 500) throw new HttpError(429, 'Sign-ups are closed for now.');
        store.add('buyers', { ...b, states: b.states.map((x) => x.toUpperCase()), signup: true, signedUpAt: today() });
        return { ok: true };
      }

      case 'GET sources':
        return store.getSettings().sources || [];
      case 'POST sources': {
        let src;
        try {
          src = cleanSource(body);
        } catch (err) {
          throw new HttpError(400, err.message);
        }
        const settings = store.getSettings();
        store.setSettings({ ...settings, sources: [...(settings.sources || []), src] });
        return src;
      }
      case 'DELETE sources/:id': {
        const settings = store.getSettings();
        const sources = (settings.sources || []).filter((x) => x.id !== id);
        store.setSettings({ ...settings, sources });
        return { deleted: sources.length !== (settings.sources || []).length };
      }
      case 'POST sources/:id/run':
        return runSource(id);

      case 'GET buyers':
        return store.list('buyers');
      case 'POST buyers': {
        const buyer = pick(body, BUYER_FIELDS);
        if (!buyer.name) throw new HttpError(400, 'Name is required');
        return store.add('buyers', buyer);
      }
      case 'DELETE buyers/:id':
        return { deleted: store.remove('buyers', id) };

      case 'GET pipeline':
        return pipeline.summarize(store.list('deals'), { today: today(), goal: goal() });
      case 'PUT settings/goal': {
        const amount = Math.max(0, Number(body.amount) || 0);
        const deadline = pipeline.daysBetween('2000-01-01', body.deadline) === null ? '' : body.deadline;
        store.setSettings({ ...store.getSettings(), goal: { amount, deadline } });
        return goal();
      }

      case 'GET checklist':
        return checklist.withProgress(store.getSettings().checklist);
      case 'PUT checklist': {
        const settings = store.getSettings();
        let next;
        try {
          next = checklist.updateItem(settings.checklist, body);
        } catch (err) {
          throw new HttpError(400, err.message);
        }
        store.setSettings({ ...settings, checklist: next });
        return checklist.withProgress(next);
      }

      default:
        throw new HttpError(404, 'Not found');
    }
  };
  handle.runAllSources = () => handleRunAll();
  return handle;
}

module.exports = { createApi, HttpError };
