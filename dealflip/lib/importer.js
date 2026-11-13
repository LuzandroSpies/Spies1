'use strict';

// Turns a county list or investor-tool export (CSV) into deals.
// Column names vary by county, so each field matches several common headers.

const MAX_ROWS = 5000;

const COLUMN_ALIASES = {
  address: ['address', 'property address', 'site address', 'situs address', 'situs', 'location', 'street address', 'property location', 'street'],
  city: ['city', 'property city', 'site city', 'situs city'],
  state: ['state', 'property state', 'site state', 'st'],
  zip: ['zip', 'zip code', 'zipcode', 'postal code', 'property zip'],
  county: ['county'],
  parcelId: ['parcel', 'parcel id', 'parcel number', 'parcel no', 'apn', 'pin', 'account', 'account number', 'tax id', 'folio'],
  ownerName: ['owner', 'owner name', 'owner 1', 'owner1', 'taxpayer', 'taxpayer name'],
  askingPrice: ['opening bid', 'minimum bid', 'min bid', 'starting bid', 'amount due', 'total due', 'taxes due', 'judgment amount', 'list price', 'asking price', 'price'],
  estimatedValue: ['arv', 'estimated value', 'est value', 'market value', 'just value', 'appraised value', 'assessed value', 'total value', 'value'],
  sqft: ['sqft', 'sq ft', 'square feet', 'living area', 'building sqft', 'living sqft'],
  beds: ['beds', 'bedrooms', 'bed', 'br'],
  baths: ['baths', 'bathrooms', 'bath', 'ba'],
  yearBuilt: ['year built', 'yr built', 'built'],
  saleDate: ['sale date', 'auction date', 'sale'],
  propertyType: ['property type', 'land use', 'use', 'class', 'type'],
};

// Minimal RFC 4180 parser: quoted fields, escaped quotes, commas and newlines in quotes.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

function norm(h) {
  return String(h).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// For each field, find the first header that matches one of its aliases (exact match first).
function mapColumns(headers) {
  const normalized = headers.map(norm);
  const used = new Set();
  const map = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    let idx = -1;
    for (const a of aliases) {
      idx = normalized.findIndex((h, i) => !used.has(i) && h === a);
      if (idx !== -1) break;
    }
    if (idx === -1) {
      for (const a of aliases) {
        if (a.length < 4) continue; // short aliases like "st" only match exactly
        idx = normalized.findIndex((h, i) => !used.has(i) && h.includes(a));
        if (idx !== -1) break;
      }
    }
    if (idx !== -1) {
      map[field] = idx;
      used.add(idx);
    }
  }
  return map;
}

function toNumber(s) {
  const n = Number(String(s ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function toIsoDate(s) {
  const t = String(s || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t);
  if (!m) return '';
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

function dedupeKey(d) {
  return `${String(d.address || '').toLowerCase().replace(/[^a-z0-9]/g, '')}|${String(d.city || '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

function guessType(raw) {
  const t = String(raw || '').toLowerCase();
  if (/duplex|2 family|two family/.test(t)) return 'duplex';
  if (/multi|apartment|triplex|fourplex/.test(t)) return 'multi-family';
  if (/condo/.test(t)) return 'condo';
  if (/vacant|land|lot/.test(t)) return 'land';
  if (/mobile|manufactured/.test(t)) return 'mobile home';
  return 'single-family';
}

// Build deals from CSV text. `defaults` fills what the file doesn't say.
function importCsv(text, defaults = {}, existing = []) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { deals: [], skipped: [{ row: 1, reason: 'The file has no data rows.' }], columns: {} };

  const headers = rows[0];
  const map = mapColumns(headers);
  if (map.address === undefined) {
    return { deals: [], skipped: [{ row: 1, reason: 'Could not find an address column. Rename it to "Address" and try again.' }], columns: map };
  }

  const repairPct = Math.min(1, Math.max(0, Number(defaults.repairPct ?? 0.2)));
  const seen = new Set(existing.map(dedupeKey));
  const deals = [];
  const skipped = [];
  const get = (r, f) => (map[f] === undefined ? '' : String(r[map[f]] ?? '').trim());

  rows.slice(1, MAX_ROWS + 1).forEach((r, i) => {
    const rowNum = i + 2;
    const address = get(r, 'address');
    if (!address) return skipped.push({ row: rowNum, reason: 'No address' });
    const price = toNumber(get(r, 'askingPrice'));
    if (!price) return skipped.push({ row: rowNum, reason: `${address}: no price or bid amount` });

    const value = toNumber(get(r, 'estimatedValue'));
    const deal = {
      address,
      city: get(r, 'city') || defaults.city || '',
      county: get(r, 'county') || defaults.county || '',
      state: (get(r, 'state') || defaults.state || '').toUpperCase().slice(0, 2),
      zip: get(r, 'zip'),
      parcelId: get(r, 'parcelId'),
      ownerName: get(r, 'ownerName'),
      propertyType: guessType(get(r, 'propertyType')),
      beds: toNumber(get(r, 'beds')),
      baths: toNumber(get(r, 'baths')),
      sqft: toNumber(get(r, 'sqft')),
      yearBuilt: toNumber(get(r, 'yearBuilt')),
      saleType: defaults.saleType || 'Tax Deed',
      saleDate: toIsoDate(get(r, 'saleDate')),
      askingPrice: price,
      estimatedValue: value,
      estimatedRepairs: Math.round(value * repairPct),
      condition: repairPct >= 0.3 ? 'heavy' : repairPct >= 0.15 ? 'medium' : 'light',
      titleAndLiens: 0,
      notes: value
        ? `Imported. Value is from the file (${headers[map.estimatedValue]}) and repairs are a rough ${Math.round(repairPct * 100)}% of it; check both against sold comps.`
        : 'Imported without a value. Add an ARV from sold comps to score this deal.',
      source: String(defaults.source || 'Import').slice(0, 80),
    };

    const key = dedupeKey(deal);
    if (seen.has(key)) return skipped.push({ row: rowNum, reason: `${address}: already in your deals` });
    seen.add(key);
    deals.push(deal);
  });

  if (rows.length - 1 > MAX_ROWS) skipped.push({ row: MAX_ROWS + 2, reason: `Only the first ${MAX_ROWS} rows were read.` });

  const columns = Object.fromEntries(Object.entries(map).map(([f, i]) => [f, headers[i]]));
  return { deals, skipped, columns };
}

module.exports = { parseCsv, mapColumns, importCsv };
