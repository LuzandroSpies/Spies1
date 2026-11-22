// Netlify Function: serves every /api/* request. See lib/netlify-handler.js.
import { getStore } from '@netlify/blobs';
import netlifyHandler from '../../lib/netlify-handler.js';
import ai from '../../lib/ai.js';
import comps from '../../lib/comps.js';
import sources from '../../lib/sources.js';

export default async (req) => {
  const rentcastKey = process.env.RENTCAST_API_KEY || '';
  const handler = netlifyHandler.makeHandler({
    blobs: getStore({ name: 'dealflip', consistency: 'strong' }),
    password: process.env.DEALFLIP_PASSWORD || '',
    ai,
    comps: rentcastKey ? (deal) => comps.checkValueAndRent(deal, { apiKey: rentcastKey }) : null,
    fetchCsv: (url) => sources.fetchCsv(url),
  });
  return handler(req);
};

export const config = { path: '/api/*' };
