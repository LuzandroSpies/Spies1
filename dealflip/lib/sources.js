'use strict';

// Saved list sources: a link to a county (or other) CSV that DealFlip pulls on a
// schedule and imports, skipping properties it already has.
const crypto = require('crypto');

const MAX_BYTES = 5_000_000;

function cleanSource(input = {}) {
  let url;
  try {
    url = new URL(String(input.url || ''));
  } catch {
    throw Object.assign(new Error('Enter the full link to the CSV file, starting with https://'), { status: 400 });
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw Object.assign(new Error('Only web links (https://) can be pulled automatically.'), { status: 400 });
  }
  const name = String(input.name || '').trim().slice(0, 80);
  if (!name) throw Object.assign(new Error('Give the list a name'), { status: 400 });
  return {
    id: input.id || `s${crypto.randomBytes(4).toString('hex')}`,
    name,
    url: url.toString(),
    saleType: String(input.saleType || 'Tax Deed').slice(0, 40),
    county: String(input.county || '').slice(0, 60),
    state: String(input.state || '').toUpperCase().slice(0, 2),
    city: String(input.city || '').slice(0, 60),
    repairPct: Math.min(1, Math.max(0, Number(input.repairPct ?? 0.2))),
  };
}

async function fetchCsv(url, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(url, { headers: { Accept: 'text/csv,text/plain,*/*' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`The link returned ${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (/html/i.test(type)) throw new Error('The link opens a web page, not a CSV file. Use the direct download link.');
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error('The file is over 5 MB');
  return text;
}

module.exports = { cleanSource, fetchCsv };
