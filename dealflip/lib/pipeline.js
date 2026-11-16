'use strict';

// Pipeline stages a deal moves through, and the alerts that keep money from slipping.
const { money } = require('./calc');

const STAGES = [
  { id: 'lead', label: 'Not started' },
  { id: 'offer', label: 'Offer sent' },
  { id: 'contract', label: 'Under contract' },
  { id: 'assigned', label: 'Investor signed' },
  { id: 'closed', label: 'Paid' },
  { id: 'dead', label: 'Dead' },
];
const STAGE_IDS = STAGES.map((s) => s.id);

const DAY = 86400000;

// Parse YYYY-MM-DD as a UTC date so day math never shifts with time zones.
function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
}

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function todayIso(now = new Date()) {
  return isoDate(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function daysBetween(fromIso, toIso) {
  const a = parseDate(fromIso);
  const b = parseDate(toIso);
  return a === null || b === null ? null : Math.round((b - a) / DAY);
}

function addDays(iso, n) {
  const t = parseDate(iso);
  return t === null ? null : isoDate(t + n * DAY);
}

// Clean a pipeline update coming from the UI.
function cleanPipeline(input = {}, previous = {}) {
  const out = { ...previous };
  if (input.stage !== undefined) {
    if (!STAGE_IDS.includes(input.stage)) throw new Error(`Unknown stage: ${input.stage}`);
    out.stage = input.stage;
  }
  for (const k of ['offerDate', 'contractDate', 'closingDate']) {
    if (input[k] !== undefined) out[k] = parseDate(input[k]) === null ? '' : input[k];
  }
  for (const k of ['contractPrice', 'buyerPrice', 'earnestMoney', 'inspectionDays']) {
    if (input[k] !== undefined) out[k] = Math.max(0, Number(input[k]) || 0);
  }
  if (input.buyerId !== undefined) out.buyerId = String(input.buyerId || '');
  if (input.note !== undefined) out.note = String(input.note || '').slice(0, 500);
  out.expectedFee = Math.max(0, (out.buyerPrice || 0) - (out.contractPrice || 0));
  return out;
}

function freeLookEnds(p) {
  return p.contractDate ? addDays(p.contractDate, p.inspectionDays || 0) : null;
}

function summarize(deals, { today, goal = {} }) {
  const goalAmount = Number(goal.amount) || 0;
  const columns = Object.fromEntries(STAGE_IDS.map((id) => [id, []]));
  const totals = { closed: 0, assigned: 0, contract: 0 };
  const alerts = [];

  for (const deal of deals) {
    const p = deal.pipeline;
    if (!p || !p.stage) continue;
    const fee = p.expectedFee || 0;
    const name = deal.address;
    const card = { id: deal.id, address: deal.address, city: deal.city, state: deal.state, fee, stage: p.stage };

    if (p.stage in totals) totals[p.stage] += fee;

    if (p.stage === 'offer' && p.offerDate) {
      const age = daysBetween(p.offerDate, today);
      card.when = `Offer sent ${age === 0 ? 'today' : `${age}d ago`}`;
      if (age >= 3) alerts.push({ level: 'info', dealId: deal.id, text: `Follow up on your offer for ${name}. You sent it ${age} days ago.` });
    }

    if (p.stage === 'contract') {
      const ends = freeLookEnds(p);
      if (ends) {
        const left = daysBetween(today, ends);
        card.when = left >= 0 ? `Free cancel ends in ${left}d` : `Free cancel ended ${-left}d ago`;
        if (left < 0) {
          alerts.push({ level: 'bad', dealId: deal.id, text: `The free cancel period on ${name} ended ${-left} days ago with no investor signed. Your ${money(p.earnestMoney || 0)} deposit is now at risk.` });
        } else if (left <= 3) {
          alerts.push({ level: 'warn', dealId: deal.id, text: `The free cancel period on ${name} ends in ${left} day${left === 1 ? '' : 's'} (${ends}) and no investor has signed. Find one, or cancel in writing before then.` });
        }
      } else {
        alerts.push({ level: 'warn', dealId: deal.id, text: `Add the date you signed the contract for ${name}, so you get deadline reminders.` });
      }
    }

    if ((p.stage === 'contract' || p.stage === 'assigned') && p.closingDate) {
      const left = daysBetween(today, p.closingDate);
      if (p.stage === 'assigned') card.when = left >= 0 ? `Closes in ${left}d` : `Closing was ${-left}d ago`;
      if (left < 0) {
        alerts.push({ level: 'bad', dealId: deal.id, text: `The closing date for ${name} (${p.closingDate}) has passed. Check with the title company, then mark it paid or agree a new date in writing.` });
      } else if (left <= 7) {
        alerts.push({ level: 'info', dealId: deal.id, text: `${name} closes in ${left} day${left === 1 ? '' : 's'}. Check the title company has everything it needs.` });
      }
    }

    columns[p.stage].push(card);
  }

  const order = { bad: 0, warn: 1, info: 2 };
  alerts.sort((a, b) => order[a.level] - order[b.level]);

  const daysLeft = goal.deadline ? daysBetween(today, goal.deadline) : null;
  const pct = (n) => (goalAmount > 0 ? Math.min(100, Math.round((n / goalAmount) * 1000) / 10) : 0);

  return {
    today,
    stages: STAGES,
    columns,
    totals,
    goal: {
      amount: goalAmount,
      deadline: goal.deadline || '',
      daysLeft,
      closedPct: pct(totals.closed),
      assignedPct: pct(totals.assigned),
      contractPct: pct(totals.contract),
      remaining: Math.max(0, goalAmount - totals.closed - totals.assigned - totals.contract),
    },
    alerts,
  };
}

module.exports = { STAGES, STAGE_IDS, cleanPipeline, summarize, todayIso, addDays, daysBetween, freeLookEnds };
