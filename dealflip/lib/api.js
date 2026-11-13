'use strict';

// Every DealFlip API route in one place. The Express server and the in-browser
// preview both call this, so they can't drift apart.
const { analyzeDeal, matchBuyer } = require('./calc');
const contracts = require('./contracts');
const pipeline = require('./pipeline');
const { importCsv } = require('./importer');

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
};
const BUYER_FIELDS = {
  name: 'string', contact: 'string', states: 'list', counties: 'list', minPrice: 'number',
  maxPrice: 'number', propertyTypes: 'list', rehabLevels: 'list', proofOfFunds: 'boolean', notes: 'string',
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
  return { ...d, quick: analysisFor(d) };
}

function createApi({ store, ai, now = () => new Date() }) {
  const today = () => pipeline.todayIso(now());
  const dealOr404 = (id) => store.get('deals', id) || (() => { throw new HttpError(404, 'Deal not found'); })();
  const buyerOr404 = (id) => store.get('buyers', id) || (() => { throw new HttpError(404, 'Buyer not found'); })();
  const goal = () => ({ ...DEFAULT_GOAL, ...(store.getSettings().goal || {}) });

  // handle('POST', '/api/deals/d1/analyze', body, query) -> JSON-able result
  return async function handle(method, path, body = {}, query = {}) {
    const p = path.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    const route = `${method} ${p.map((seg, i) => (i === 1 && (p[0] === 'deals' || p[0] === 'buyers') && seg !== 'import' ? ':id' : seg)).join('/')}`;
    const id = p[1];

    switch (route) {
      case 'GET status':
        return { ai: ai.aiAvailable(), model: ai.MODEL, today: today() };

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
        const result = importCsv(csv, defaults, store.list('deals'));
        const added = store.addMany('deals', result.deals.map((d) => pick(d, DEAL_FIELDS)));
        const counts = { works: 0, tight: 0, 'does-not-work': 0, 'needs-value': 0 };
        for (const d of added) counts[d.estimatedValue > 0 ? analysisFor(d).verdict : 'needs-value']++;
        return { added: added.length, counts, skipped: result.skipped.slice(0, 50), skippedCount: result.skipped.length, columns: result.columns, source: defaults.source || 'Import' };
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
      case 'POST deals/:id/buyers': {
        const deal = dealOr404(id);
        const price = Number(body.price) || deal.askingPrice;
        return store
          .list('buyers')
          .map((b) => ({ buyer: b, ...matchBuyer(b, deal, price) }))
          .filter((m) => m.score > 0)
          .sort((x, y) => y.score - x.score);
      }
      case 'POST deals/:id/ai/review': {
        const deal = dealOr404(id);
        return ai.reviewDeal(deal, analysisFor(deal, body.inputs));
      }
      case 'POST deals/:id/ai/offer': {
        const deal = dealOr404(id);
        return ai.draftOffer(deal, contractTerms(deal, body.terms), analysisFor(deal, body.inputs));
      }
      case 'POST deals/:id/ai/outreach': {
        const deal = dealOr404(id);
        const buyer = buyerOr404(body.buyerId);
        const a = analysisFor(deal, body.inputs);
        return ai.draftOutreach(deal, buyer, Number(body.price) || a.inputs.buyerPrice || a.buyerMaxPrice, a);
      }
      // Contract drafts are fixed templates filled from the deal, not AI-written.
      case 'POST deals/:id/contracts/purchase': {
        const deal = dealOr404(id);
        return { text: contracts.purchaseAgreement(deal, contractTerms(deal, body.terms)) };
      }
      case 'POST deals/:id/contracts/assignment': {
        const deal = dealOr404(id);
        const buyer = buyerOr404(body.buyerId);
        const a = analysisFor(deal, body.inputs);
        return {
          text: contracts.assignmentAgreement(deal, contractTerms(deal, body.terms), buyer, {
            contractPrice: a.inputs.contractPrice,
            buyerPrice: a.inputs.buyerPrice,
          }),
        };
      }

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

      default:
        throw new HttpError(404, 'Not found');
    }
  };
}

module.exports = { createApi, HttpError };
