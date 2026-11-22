// Netlify Scheduled Function: pulls every saved list link once a day.
import { getStore } from '@netlify/blobs';
import netlifyHandler from '../../lib/netlify-handler.js';
import ai from '../../lib/ai.js';
import sources from '../../lib/sources.js';

export default async () => {
  const results = await netlifyHandler.runDailyPull({
    blobs: getStore({ name: 'dealflip', consistency: 'strong' }),
    ai,
    fetchCsv: (url) => sources.fetchCsv(url),
  });
  for (const r of results) console.log(`[lists] ${r.name || r.id}: ${r.lastResult?.ok ? `${r.lastResult.added} new` : `failed: ${r.lastResult?.error}`}`);
};

export const config = { schedule: '@daily' };
