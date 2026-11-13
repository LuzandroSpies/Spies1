'use strict';

// Value and rent estimates with nearby comparables, from RentCast (rentcast.io).
// Needs RENTCAST_API_KEY. Their comparables include recent listings, not only
// closed sales, so treat the result as a second opinion, not an appraisal.

const BASE = 'https://api.rentcast.io/v1';

const TYPE_MAP = {
  'single-family': 'Single Family',
  duplex: 'Multi-Family',
  'multi-family': 'Multi-Family',
  condo: 'Condo',
  'mobile home': 'Manufactured',
  land: 'Land',
};

function fullAddress(deal) {
  return [deal.address, deal.city, [deal.state, deal.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

function query(deal) {
  const q = new URLSearchParams({ address: fullAddress(deal), compCount: '5' });
  const type = TYPE_MAP[deal.propertyType];
  if (type) q.set('propertyType', type);
  if (deal.beds) q.set('bedrooms', String(deal.beds));
  if (deal.baths) q.set('bathrooms', String(deal.baths));
  if (deal.sqft) q.set('squareFootage', String(deal.sqft));
  return q;
}

function comps(list) {
  return (Array.isArray(list) ? list : []).slice(0, 5).map((c) => ({
    address: c.formattedAddress || c.addressLine1 || '',
    price: Math.round(Number(c.price) || 0),
    beds: c.bedrooms ?? null,
    baths: c.bathrooms ?? null,
    sqft: c.squareFootage ?? null,
    distanceMiles: c.distance != null ? Math.round(c.distance * 100) / 100 : null,
    status: c.status || '',
    date: String(c.removedDate || c.listedDate || c.lastSeenDate || '').slice(0, 10),
  }));
}

async function getJson(fetchImpl, url, apiKey) {
  const res = await fetchImpl(url, { headers: { Accept: 'application/json', 'X-Api-Key': apiKey } });
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error('RentCast rejected the API key'), { status: 502 });
  if (res.status === 429) throw Object.assign(new Error('RentCast limit reached for now; try again later'), { status: 503 });
  if (res.status === 404) return null;
  if (!res.ok) throw Object.assign(new Error(`RentCast error ${res.status}`), { status: 502 });
  return res.json();
}

async function checkValueAndRent(deal, { apiKey, fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey) {
    throw Object.assign(new Error('Add a RentCast API key (RENTCAST_API_KEY) to check values and rents.'), { status: 400 });
  }
  if (!deal.address || !(deal.city || deal.zip)) {
    throw Object.assign(new Error('The deal needs an address with a city or ZIP code.'), { status: 400 });
  }
  const q = query(deal).toString();
  const [value, rent] = await Promise.all([
    getJson(fetchImpl, `${BASE}/avm/value?${q}`, apiKey),
    getJson(fetchImpl, `${BASE}/avm/rent/long-term?${q}`, apiKey),
  ]);
  return {
    source: 'RentCast',
    checkedAt: new Date().toISOString().slice(0, 10),
    value: value?.price ? { estimate: Math.round(value.price), low: Math.round(value.priceRangeLow || 0), high: Math.round(value.priceRangeHigh || 0), comps: comps(value.comparables) } : null,
    rent: rent?.rent ? { estimate: Math.round(rent.rent), low: Math.round(rent.rentRangeLow || 0), high: Math.round(rent.rentRangeHigh || 0), comps: comps(rent.comparables) } : null,
  };
}

module.exports = { checkValueAndRent, fullAddress };
