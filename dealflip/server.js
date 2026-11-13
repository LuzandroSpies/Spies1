'use strict';

const path = require('path');
const express = require('express');
const store = require('./lib/store');
const { analyzeDeal, matchBuyer } = require('./lib/calc');
const ai = require('./lib/ai');
const contracts = require('./lib/contracts');

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DEAL_FIELDS = {
  address: 'string', city: 'string', county: 'string', state: 'string', propertyType: 'string',
  beds: 'number', baths: 'number', sqft: 'number', yearBuilt: 'number', saleType: 'string',
  askingPrice: 'number', estimatedValue: 'number', estimatedRepairs: 'number', condition: 'string',
  titleAndLiens: 'number', notes: 'string', saleDate: 'string',
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

function dealOr404(req, res) {
  const deal = store.get('deals', req.params.id);
  if (!deal) res.status(404).json({ error: 'Deal not found' });
  return deal;
}

// Analysis inputs default to the deal's own numbers when the user hasn't set them.
// If no buyer price is given, assume the most a 70%-rule investor would pay.
function analysisFor(deal, inputs = {}) {
  const base = {
    arv: deal.estimatedValue,
    contractPrice: deal.askingPrice,
    repairs: deal.estimatedRepairs,
    titleAndLiens: deal.titleAndLiens,
    ...inputs,
  };
  if (!Number(base.buyerPrice)) {
    base.buyerPrice = Math.max(0, analyzeDeal(base).buyerMaxPrice);
  }
  return analyzeDeal(base);
}

app.get('/api/status', (req, res) => {
  res.json({ ai: ai.aiAvailable(), model: ai.MODEL });
});

app.get('/api/deals', (req, res) => {
  const { saleType, state, maxPrice } = req.query;
  let deals = store.list('deals');
  if (saleType) deals = deals.filter((d) => d.saleType === saleType);
  if (state) deals = deals.filter((d) => d.state === state);
  if (maxPrice) deals = deals.filter((d) => d.askingPrice <= Number(maxPrice));
  res.json(deals.map((d) => ({ ...d, quick: analysisFor(d) })));
});

app.post('/api/deals', (req, res) => {
  const deal = pick(req.body, DEAL_FIELDS);
  if (!deal.address || !deal.askingPrice) return res.status(400).json({ error: 'Address and price are required' });
  res.status(201).json(store.add('deals', deal));
});

app.get('/api/deals/:id', (req, res) => {
  const deal = dealOr404(req, res);
  if (deal) res.json(deal);
});

app.delete('/api/deals/:id', (req, res) => {
  res.json({ deleted: store.remove('deals', req.params.id) });
});

app.post('/api/deals/:id/analyze', (req, res) => {
  const deal = dealOr404(req, res);
  if (deal) res.json(analysisFor(deal, req.body));
});

app.post('/api/deals/:id/buyers', (req, res) => {
  const deal = dealOr404(req, res);
  if (!deal) return;
  const price = Number(req.body?.price) || deal.askingPrice;
  const matches = store
    .list('buyers')
    .map((b) => ({ buyer: b, ...matchBuyer(b, deal, price) }))
    .filter((m) => m.score > 0)
    .sort((x, y) => y.score - x.score);
  res.json(matches);
});

app.get('/api/buyers', (req, res) => res.json(store.list('buyers')));

app.post('/api/buyers', (req, res) => {
  const buyer = pick(req.body, BUYER_FIELDS);
  if (!buyer.name) return res.status(400).json({ error: 'Name is required' });
  res.status(201).json(store.add('buyers', buyer));
});

app.delete('/api/buyers/:id', (req, res) => {
  res.json({ deleted: store.remove('buyers', req.params.id) });
});

app.post('/api/deals/:id/ai/review', async (req, res) => {
  const deal = dealOr404(req, res);
  if (deal) res.json(await ai.reviewDeal(deal, analysisFor(deal, req.body?.inputs)));
});

app.post('/api/deals/:id/ai/offer', async (req, res) => {
  const deal = dealOr404(req, res);
  if (!deal) return;
  const t = req.body?.terms || {};
  const terms = {
    price: Number(t.price) || deal.askingPrice,
    closingDays: Number(t.closingDays) || 30,
    earnestMoney: Number(t.earnestMoney) || 0,
    inspectionDays: Number(t.inspectionDays) || 10,
    sellerCredits: Number(t.sellerCredits) || 0,
    assignable: t.assignable !== false,
    buyerName: String(t.buyerName || '').slice(0, 100),
  };
  res.json(await ai.draftOffer(deal, terms, analysisFor(deal, req.body?.inputs)));
});

app.post('/api/deals/:id/ai/outreach', async (req, res) => {
  const deal = dealOr404(req, res);
  if (!deal) return;
  const buyer = store.get('buyers', req.body?.buyerId);
  if (!buyer) return res.status(404).json({ error: 'Buyer not found' });
  const analysis = analysisFor(deal, req.body?.inputs);
  const price = Number(req.body?.price) || analysis.inputs.buyerPrice || analysis.buyerMaxPrice;
  res.json(await ai.draftOutreach(deal, buyer, price, analysis));
});

// Contract drafts are fixed templates filled from the deal, not AI-written.
function contractTerms(deal, t = {}) {
  return {
    price: Number(t.price) || deal.askingPrice,
    closingDays: Number(t.closingDays) || 30,
    earnestMoney: Number(t.earnestMoney) || 0,
    inspectionDays: Number(t.inspectionDays) || 10,
    sellerCredits: Number(t.sellerCredits) || 0,
    assigneeDeposit: Number(t.assigneeDeposit) || 0,
    buyerName: String(t.buyerName || '').slice(0, 100),
    sellerName: String(t.sellerName || '').slice(0, 100),
    titleCompany: String(t.titleCompany || '').slice(0, 100),
  };
}

app.post('/api/deals/:id/contracts/purchase', (req, res) => {
  const deal = dealOr404(req, res);
  if (deal) res.json({ text: contracts.purchaseAgreement(deal, contractTerms(deal, req.body?.terms)) });
});

app.post('/api/deals/:id/contracts/assignment', (req, res) => {
  const deal = dealOr404(req, res);
  if (!deal) return;
  const buyer = store.get('buyers', req.body?.buyerId);
  if (!buyer) return res.status(404).json({ error: 'Buyer not found' });
  const a = analysisFor(deal, req.body?.inputs);
  const text = contracts.assignmentAgreement(deal, contractTerms(deal, req.body?.terms), buyer, {
    contractPrice: a.inputs.contractPrice,
    buyerPrice: a.inputs.buyerPrice,
  });
  res.json({ text });
});

if (require.main === module) {
  const port = process.env.PORT || 3100;
  app.listen(port, () => console.log(`DealFlip running at http://localhost:${port}`));
}

module.exports = app;
