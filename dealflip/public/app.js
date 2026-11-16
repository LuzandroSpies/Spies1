'use strict';

// ---- api (the preview build swaps this block for an in-browser version) ----
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status})`);
  return data;
}
// ---- end api ----

// ---------- small helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const money = (n) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(Number(n) || 0)).toLocaleString('en-US')}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

const STAGES = [
  { id: 'lead', label: 'Not started' },
  { id: 'offer', label: 'Offer sent' },
  { id: 'contract', label: 'Under contract' },
  { id: 'assigned', label: 'Investor signed' },
  { id: 'closed', label: 'Paid' },
  { id: 'dead', label: 'Dead' },
];
const stageLabel = (id) => STAGES.find((s) => s.id === id)?.label || 'Not started';

const VERDICT = {
  works: { tag: 'Good deal', cls: 'good' },
  tight: { tag: 'Tight', cls: 'warn' },
  'does-not-work': { tag: "Doesn't work", cls: 'bad' },
  'needs-value': { tag: 'Needs a value', cls: 'neutral' },
};
const verdictOf = (d) => (d.estimatedValue > 0 ? d.quick.verdict : 'needs-value');

const state = {
  status: {},
  deals: [],
  filter: 'all',
  search: '',
  source: '',
  deal: null,
  inputs: {},
  terms: {},
  rental: {},
  analysis: null,
  step: 1,
};

// ---------- navigation ----------
function showView(view) {
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  for (const v of ['deals', 'progress', 'investors']) $(`#view-${v}`).hidden = v !== view;
  if (view === 'progress') loadProgress();
  if (view === 'investors') loadInvestors();
  window.scrollTo(0, 0);
}
$$('.tab').forEach((b) =>
  b.addEventListener('click', () => {
    // Tapping Deals again while on a deal goes back to the list, like most phone apps.
    if (b.dataset.view === 'deals' && !$('#view-deals').hidden && state.deal) return closeDeal();
    showView(b.dataset.view);
  }),
);

// ---------- dialogs ----------
function openDialog(d) {
  if (!d.open) d.showModal();
}
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) e.target.closest('dialog')?.close();
});

function openDoc(title, text, note = '') {
  $('#doc-title').textContent = title;
  $('#doc-note').textContent = note;
  $('#doc-text').textContent = text;
  $('#doc-copy').textContent = 'Copy';
  openDialog($('#doc-dialog'));
}

async function copyText(text, btn, selectEl) {
  try {
    // Some browsers never answer the clipboard request; give up after a second.
    await Promise.race([navigator.clipboard.writeText(text), new Promise((_, no) => setTimeout(no, 1000))]);
    btn.textContent = 'Copied';
  } catch {
    // Some app views block the clipboard: select the text so it can be copied by hand.
    const range = document.createRange();
    range.selectNodeContents(selectEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    btn.textContent = 'Selected: copy it now';
  }
}
$('#doc-copy').addEventListener('click', (e) => copyText($('#doc-text').textContent, e.target, $('#doc-text')));

// Run a document-producing request from a button, then show it in the document sheet.
async function runDoc(button, title, path, body) {
  const old = button.textContent;
  button.disabled = true;
  button.textContent = 'Writing…';
  try {
    const r = await api(path, { method: 'POST', body });
    const note = r.ai === false ? 'Written from a template. Read it through before you send it.' : r.ai ? 'Written by Claude. Read it through before you send it.' : 'A starting draft. Have a local attorney check it before you use it.';
    openDoc(title, r.text, note);
  } catch (err) {
    openDoc(title, err.message);
  } finally {
    button.disabled = false;
    button.textContent = old;
  }
}

// ---------- deals list ----------
async function loadDeals() {
  state.deals = await api('/api/deals');
  const sources = [...new Set(state.deals.map((d) => d.source || 'Sample'))].sort();
  const sel = $('#f-source');
  sel.hidden = sources.length < 2;
  sel.innerHTML = '<option value="">All lists</option>' + sources.map((s) => `<option>${esc(s)}</option>`).join('');
  sel.value = sources.includes(state.source) ? state.source : '';
  renderList();
}

function visibleDeals() {
  const q = state.search.trim().toLowerCase();
  const rank = { works: 0, tight: 1, 'does-not-work': 2, 'needs-value': 3 };
  return state.deals
    .filter((d) => !q || `${d.address} ${d.city} ${d.county} ${d.state}`.toLowerCase().includes(q))
    .filter((d) => !state.source || (d.source || 'Sample') === state.source)
    .filter((d) => (state.filter === 'good' ? verdictOf(d) === 'works' : state.filter === 'tracked' ? d.pipeline?.stage && d.pipeline.stage !== 'lead' : true))
    .sort((a, b) => rank[verdictOf(a)] - rank[verdictOf(b)] || b.quick.realisticFee - a.quick.realisticFee);
}

const LIST_LIMIT = 150;
function renderList() {
  const deals = visibleDeals();
  const ul = $('#deal-list');
  if (!deals.length) {
    ul.innerHTML = `<li class="empty-small">${state.deals.length ? 'Nothing matches. Try another filter.' : 'No deals yet. Tap <b>+ Add deals</b> to start.'}</li>`;
    $('#deal-count').textContent = '';
    return;
  }
  $('#deal-count').textContent = deals.length > LIST_LIMIT ? `Showing the best ${LIST_LIMIT} of ${deals.length}. Search or filter to narrow it down.` : plural(deals.length, 'deal');
  ul.innerHTML = deals
    .slice(0, LIST_LIMIT)
    .map((d) => {
      const v = verdictOf(d);
      const side =
        v === 'works' || v === 'tight'
          ? `<span class="dc-fee ${VERDICT[v].cls}">${money(d.quick.realisticFee)}</span><span class="dc-label">${v === 'works' ? 'you could make' : 'tight'}</span>`
          : v === 'needs-value'
            ? '<span class="dc-fee neutral">?</span><span class="dc-label">needs a value</span>'
            : '<span class="dc-fee bad">Skip</span><span class="dc-label">doesn\'t work</span>';
      const stage = d.pipeline?.stage && d.pipeline.stage !== 'lead' ? `<span class="pill">${esc(stageLabel(d.pipeline.stage))}</span>` : '';
      return `<li><button class="deal-card ${state.deal?.id === d.id ? 'active' : ''}" data-id="${esc(d.id)}" type="button">
        <span class="dc-main"><b>${esc(d.address)}</b><span class="muted">${esc([d.city, d.state].filter(Boolean).join(', '))} · ${esc(d.saleType)} · asking ${money(d.askingPrice)}</span>${stage}</span>
        <span class="dc-side">${side}</span>
      </button></li>`;
    })
    .join('');
}

$('#deal-list').addEventListener('click', (e) => {
  const b = e.target.closest('.deal-card');
  if (b) openDeal(b.dataset.id);
});
$('#search').addEventListener('input', debounce((e) => { state.search = e.target.value; renderList(); }, 120));
$$('.chip[data-filter]').forEach((c) =>
  c.addEventListener('click', () => {
    state.filter = c.dataset.filter;
    $$('.chip[data-filter]').forEach((x) => x.classList.toggle('active', x === c));
    renderList();
  }),
);
$('#f-source').addEventListener('change', (e) => { state.source = e.target.value; renderList(); });

// ---------- deal page ----------
async function openDeal(id) {
  const deal = state.deals.find((d) => d.id === id) || (await api(`/api/deals/${encodeURIComponent(id)}`));
  const quick = deal.quick || (await api(`/api/deals/${encodeURIComponent(id)}/analyze`, { method: 'POST', body: {} }));
  const p = deal.pipeline || {};
  state.deal = deal;
  state.step = 1;
  state.rental = {};
  state.inputs = {
    arv: deal.estimatedValue,
    repairs: deal.estimatedRepairs,
    titleAndLiens: deal.titleAndLiens,
    contractPrice: p.contractPrice || deal.askingPrice,
    // Start at what an investor would realistically pay, not a wishful number.
    buyerPrice: p.buyerPrice || Math.max(deal.askingPrice, quick.buyerMaxPrice),
    yourCosts: 0,
    earnestMoney: p.earnestMoney || Math.min(1000, Math.round(deal.askingPrice * 0.05)),
  };
  const keep = state.terms;
  state.terms = {
    closingDays: 30,
    inspectionDays: p.inspectionDays || 10,
    sellerCredits: 0,
    assignable: true,
    sellerName: deal.ownerName || '',
    assigneeDeposit: 1000,
    buyerName: keep.buyerName || '', // yours, so it carries over between deals
    titleCompany: keep.titleCompany || '',
  };
  $('#view-deals').classList.add('show-detail');
  renderList();
  renderDetail();
  await refresh();
  if (window.matchMedia('(max-width: 860px)').matches) window.scrollTo(0, 0);
}

function closeDeal() {
  $('#view-deals').classList.remove('show-detail');
  state.deal = null;
  renderList();
}

function moneyField(key, label, help = '', scope = 'inputs') {
  const attr = scope === 'inputs' ? 'data-key' : 'data-term';
  return `<label class="field"><span class="field-label">${label}</span>
    <span class="money-input"><span aria-hidden="true">$</span><input type="number" inputmode="numeric" min="0" step="100" ${attr}="${key}" id="f-${key}" value="${esc(state[scope][key])}"></span>
    ${help ? `<span class="help">${help}</span>` : ''}</label>`;
}
function numField(key, label, help = '') {
  return `<label class="field"><span class="field-label">${label}</span>
    <input type="number" inputmode="numeric" min="0" data-term="${key}" id="f-${key}" value="${esc(state.terms[key])}">
    ${help ? `<span class="help">${help}</span>` : ''}</label>`;
}
function textField(key, label, placeholder = '') {
  return `<label class="field"><span class="field-label">${label}</span>
    <input data-term="${key}" id="f-${key}" value="${esc(state.terms[key])}" placeholder="${esc(placeholder)}"></label>`;
}

function renderDetail() {
  const d = state.deal;
  const tax = /tax/i.test(d.saleType);
  const facts = [d.beds ? `${d.beds} bed` : '', d.baths ? `${d.baths} bath` : '', d.sqft ? `${Number(d.sqft).toLocaleString('en-US')} sq ft` : '', d.yearBuilt ? `built ${d.yearBuilt}` : ''].filter(Boolean).join(' · ');

  $('#detail').innerHTML = `
    <button class="back link" id="back" type="button">← All deals</button>
    <div class="deal-head">
      <div class="deal-title">
        <h1>${esc(d.address)}</h1>
        <p class="muted">${esc([d.city, d.county ? `${d.county} County` : '', d.state].filter(Boolean).join(', '))} · ${esc(d.saleType)}${facts ? ` · ${esc(facts)}` : ''}</p>
      </div>
      <div class="status-box">
        <label class="field compact"><span class="field-label">Status</span>
          <select id="p-stage">${STAGES.map((s) => `<option value="${s.id}">${s.label}</option>`).join('')}</select></label>
        <div id="status-extra"></div>
        <span class="saved" id="p-saved" aria-live="polite"></span>
      </div>
    </div>

    <section class="answer card" id="answer"></section>

    ${tax ? `<details class="notice"><summary>This is a tax sale: read before you offer</summary>
      <p>County tax sales are usually auctions. You bid, pay the full amount within days, and usually can't pass the deal to an investor. This only works if you make a deal with the owner <b>before</b> the sale. Some states also let the old owner buy it back for a while after. Check the county's rules first.</p></details>` : ''}
    ${d.notes ? `<p class="muted small">${esc(d.notes)}</p>` : ''}

    <nav class="steps" aria-label="Steps">
      <button class="step" data-step="1" type="button"><span>1</span>Numbers</button>
      <button class="step" data-step="2" type="button"><span>2</span>Seller</button>
      <button class="step" data-step="3" type="button"><span>3</span>Investor</button>
    </nav>

    <section class="panel" data-panel-step="1">
      <p class="lead">Check the numbers. Change any of them and the answer above updates.</p>
      <div class="fields">
        ${moneyField('arv', 'Value after repairs', 'What it would sell for once fixed up. Check recent sales of similar houses nearby.')}
        ${moneyField('repairs', 'Repair cost', 'Your best guess of what the fix-up costs.')}
        ${moneyField('contractPrice', 'Your price', 'What you agree to pay the owner.')}
        ${moneyField('buyerPrice', 'Price to investor', '<span id="investor-max-hint"></span>')}
      </div>
      ${state.status.comps ? `<button class="secondary" id="comps-btn" type="button">Check value &amp; rent online</button><div id="comps-out">${d.comps ? renderComps(d.comps) : ''}</div>` : ''}
      <details class="fold-plain">
        <summary>More costs</summary>
        <div class="fields">
          ${moneyField('titleAndLiens', 'Unpaid taxes &amp; liens', 'Back taxes, liens or legal costs to clear the title.')}
          ${moneyField('yourCosts', 'Your own costs', 'Marketing, travel, fees. Taken off what you keep.')}
        </div>
      </details>
      <details class="fold-plain" id="rental-fold">
        <summary>Rental numbers (for investors who keep houses to rent out)</summary>
        <div class="fields">
          <label class="field"><span class="field-label">Monthly rent</span>
            <span class="money-input"><span aria-hidden="true">$</span><input type="number" inputmode="numeric" min="0" step="25" data-rent="rent" id="r-rent"></span>
            <span class="help" id="rent-help"></span></label>
        </div>
        <div id="rental-out"></div>
        <details class="fold-plain">
          <summary>Change the assumptions</summary>
          <div class="fields">
            <label class="field"><span class="field-label">Property tax per year</span><input type="number" min="0" step="100" data-rent="taxesYearly" id="r-taxesYearly"></label>
            <label class="field"><span class="field-label">Insurance per year</span><input type="number" min="0" step="100" data-rent="insuranceYearly" id="r-insuranceYearly"></label>
            <label class="field"><span class="field-label">Refinance at (% of value)</span><input type="number" min="0" max="100" step="5" data-rent-pct="refiLtv" id="r-refiLtv" value="75"></label>
            <label class="field"><span class="field-label">Loan interest rate (%)</span><input type="number" min="0" max="20" step="0.125" data-rent-pct="refiRate" id="r-refiRate" value="7.5"></label>
          </div>
          <p class="muted small">Also assumed: 8% empty months, 8% upkeep, 10% property manager, 5% big repairs, 30-year loan.</p>
        </details>
      </details>
      <div class="panel-actions"><button data-goto="2" type="button">Next: make an offer →</button></div>
    </section>

    <section class="panel" data-panel-step="2" hidden>
      <p class="lead">Make your offer to the owner.</p>
      <div class="fields">
        ${textField('buyerName', 'Your name or company', 'Shown as the buyer')}
        ${textField('sellerName', "Owner's name", 'From the county record')}
        ${moneyField('earnestMoney', 'Deposit', 'Money held by the title company until closing.')}
        ${numField('inspectionDays', 'Days you can cancel free', 'Cancel for any reason in this time and get the deposit back.')}
        ${numField('closingDays', 'Days to close')}
        ${textField('titleCompany', 'Title company', 'Holds the deposit and runs the closing')}
      </div>
      <div class="explain" id="cancel-explain"></div>
      <div class="button-row">
        <button id="draft-offer" type="button">Write offer letter</button>
        <button class="secondary" id="draft-purchase" type="button">Purchase agreement</button>
      </div>
      <div class="panel-actions"><button class="secondary" data-goto="1" type="button">← Back</button><button data-goto="3" type="button">Next: find an investor →</button></div>
    </section>

    <section class="panel" data-panel-step="3" hidden>
      <p class="lead">Investors who fit this deal. Send them the deal, then the agreement once they say yes.</p>
      <div id="matches"></div>
      <details class="fold-plain">
        <summary>Agreement details</summary>
        <div class="fields">${moneyField('assigneeDeposit', "Investor's deposit", 'They lose it if they back out.', 'terms')}</div>
      </details>
      <div class="panel-actions"><button class="secondary" data-goto="2" type="button">← Back</button></div>
    </section>

    ${!d.sample ? '<button class="link danger" id="delete-deal" type="button">Delete this deal</button>' : ''}`;

  $('#p-stage').value = d.pipeline?.stage || 'lead';
  renderStatusExtra();
  showStep(state.step);
}

function showStep(n) {
  state.step = n;
  $$('.step').forEach((b) => b.classList.toggle('active', Number(b.dataset.step) === n));
  $$('[data-panel-step]').forEach((p) => (p.hidden = Number(p.dataset.panelStep) !== n));
}

// One listener for everything inside the deal page.
$('#detail').addEventListener('click', async (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  const id = state.deal ? encodeURIComponent(state.deal.id) : '';
  if (t.id === 'back') return closeDeal();
  if (t.dataset.step) return showStep(Number(t.dataset.step));
  if (t.dataset.goto) {
    showStep(Number(t.dataset.goto));
    return $('.steps').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  if (t.id === 'use-max') return setInput('buyerPrice', state.analysis.buyerMaxPrice);
  if (t.id === 'second-opinion') return runDoc(t, 'Second opinion', `/api/deals/${id}/ai/review`, { inputs: state.inputs });
  if (t.id === 'draft-offer') return runDoc(t, 'Offer letter', `/api/deals/${id}/ai/offer`, { terms: termsNow(), inputs: state.inputs });
  if (t.id === 'draft-purchase') return runDoc(t, 'Purchase agreement', `/api/deals/${id}/contracts/purchase`, { terms: termsNow() });
  if (t.dataset.email) return runDoc(t, 'Email to investor', `/api/deals/${id}/ai/outreach`, { buyerId: t.dataset.email, price: state.inputs.buyerPrice, inputs: state.inputs, rental: state.rental });
  if (t.dataset.assign) return runDoc(t, 'Assignment agreement', `/api/deals/${id}/contracts/assignment`, { buyerId: t.dataset.assign, terms: termsNow(), inputs: state.inputs });
  if (t.id === 'comps-btn') return checkComps(t);
  if (t.id === 'use-value') return setInput('arv', state.deal.comps.value.estimate);
  if (t.id === 'go-investors') return showView('investors');
  if (t.id === 'delete-deal') {
    if (t.dataset.confirm !== 'yes') {
      t.dataset.confirm = 'yes';
      t.textContent = 'Tap again to delete for good';
      return;
    }
    await api(`/api/deals/${id}`, { method: 'DELETE' });
    closeDeal();
    $('#detail').innerHTML = '<div class="empty-state"><h2>Deal deleted</h2></div>';
    return loadDeals();
  }
});

function setInput(key, value) {
  state.inputs[key] = value;
  const el = $(`#f-${key}`);
  if (el) el.value = value;
  refresh();
}

const debouncedRefresh = debounce(refresh, 200);
$('#detail').addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.key) {
    state.inputs[t.dataset.key] = Number(t.value) || 0;
    debouncedRefresh();
  } else if (t.dataset.rent || t.dataset.rentPct) {
    const k = t.dataset.rent || t.dataset.rentPct;
    if (t.value === '') delete state.rental[k];
    else state.rental[k] = t.dataset.rentPct ? Number(t.value) / 100 : Number(t.value);
    debouncedRefresh();
  } else if (t.dataset.term) {
    state.terms[t.dataset.term] = t.type === 'number' ? Number(t.value) || 0 : t.value;
    if (t.dataset.term === 'inspectionDays') renderCancelExplain();
  }
});
$('#detail').addEventListener('change', (e) => {
  if (e.target.id === 'p-stage') {
    renderStatusExtra();
    saveStatus();
  } else if (e.target.dataset.pipe) saveStatus();
});

function termsNow() {
  return { ...state.terms, price: state.inputs.contractPrice, earnestMoney: state.inputs.earnestMoney };
}

async function refresh() {
  const d = state.deal;
  if (!d) return;
  const id = encodeURIComponent(d.id);
  const [a, matches, rental] = await Promise.all([
    api(`/api/deals/${id}/analyze`, { method: 'POST', body: state.inputs }),
    api(`/api/deals/${id}/buyers`, { method: 'POST', body: { price: state.inputs.buyerPrice } }),
    api(`/api/deals/${id}/rental`, { method: 'POST', body: { inputs: state.inputs, rental: state.rental } }),
  ]);
  if (state.deal !== d) return; // switched deals mid-request
  state.analysis = a;
  renderAnswer(a);
  renderMatches(matches);
  renderRental(rental);
  renderCancelExplain();
}

function renderAnswer(a) {
  const noValue = !(a.inputs.arv > 0);
  const v = noValue ? 'needs-value' : a.verdict;
  const first = a.flags.find((f) => f.level === 'bad') || a.flags.find((f) => f.level === 'warn');
  const headline = {
    works: `You could make about ${money(a.yourNet)}`,
    tight: `You could make about ${money(a.yourNet)}, but it's tight`,
    'does-not-work': "This doesn't work at these numbers",
    'needs-value': 'Add the value after repairs to see the answer',
  }[v];
  const others = a.flags.filter((f) => f !== first);
  $('#answer').innerHTML = `
    <span class="tag ${VERDICT[v].cls}">${VERDICT[v].tag}</span>
    <h2 class="headline">${headline}</h2>
    ${noValue ? '' : `<div class="flow">
      <div class="flow-step"><span class="flow-label">You pay the owner</span><span class="flow-value">${money(a.inputs.contractPrice)}</span></div>
      <span class="flow-arrow" aria-hidden="true">→</span>
      <div class="flow-step"><span class="flow-label">Investor pays</span><span class="flow-value">${money(a.inputs.buyerPrice)}</span></div>
      <span class="flow-arrow" aria-hidden="true">→</span>
      <div class="flow-step keep ${a.yourNet > 0 ? 'pos' : 'neg'}"><span class="flow-label">You keep</span><span class="flow-value">${money(a.yourNet)}</span></div>
    </div>
    <p class="muted small">The investor makes about <b class="${a.buyerProfit < 0 ? 'neg-text' : ''}">${money(a.buyerProfit)}</b> after repairs and selling costs. If they can't profit, they won't buy.</p>`}
    ${first ? `<p class="flag ${first.level}">${esc(first.text)}</p>` : ''}
    ${others.length ? `<details class="fold-plain"><summary>${plural(others.length, 'more note')}</summary>${others.map((f) => `<p class="flag ${f.level}">${esc(f.text)}</p>`).join('')}</details>` : ''}
    <button class="secondary small-btn" id="second-opinion" type="button">Get a second opinion</button>`;
  const hint = $('#investor-max-hint');
  if (hint) {
    hint.innerHTML = noValue ? 'What the investor pays you.' : `Investors usually pay up to <b>${money(a.buyerMaxPrice)}</b> for this house. <button class="link" id="use-max" type="button">Use it</button>`;
  }
}

function renderMatches(matches) {
  const box = $('#matches');
  if (!box) return;
  if (!matches.length) {
    box.innerHTML = `<div class="empty-small">No investors on your list fit this deal yet. <button class="link" id="go-investors" type="button">Add investors</button></div>`;
    return;
  }
  box.innerHTML = matches
    .map((m) => {
      const fit = m.score >= 70 ? ['Great fit', 'good'] : m.score >= 40 ? ['Partial fit', 'warn'] : ['Weak fit', 'neutral'];
      return `<div class="match">
        <div class="match-top"><b>${esc(m.buyer.name.replace(/^Sample Buyer: /, ''))}</b><span class="tag ${fit[1]}">${fit[0]}</span></div>
        <p class="muted small">${esc(m.reasons.join(' · '))}${m.buyer.sample ? ' · sample' : ''}</p>
        <div class="button-row">
          <button class="secondary" data-email="${esc(m.buyer.id)}" type="button">Write email</button>
          <button class="secondary" data-assign="${esc(m.buyer.id)}" type="button">Assignment agreement</button>
        </div>
      </div>`;
    })
    .join('');
}

function renderRental(r) {
  const out = $('#rental-out');
  if (!out) return;
  for (const k of ['rent', 'taxesYearly', 'insuranceYearly']) {
    const el = $(`#r-${k}`);
    if (el && el.value === '') el.placeholder = r.inputs[k];
  }
  $('#rent-help').textContent = state.rental.rent ? '' : `Using ${money(r.inputs.rent)} from ${r.rentSource}. Type the real rent if you know it.`;
  const sign = (n) => (n < 0 ? 'neg' : 'pos');
  out.innerHTML = `
    <div class="mini-stats">
      <div><span>Monthly profit, no loan</span><b class="${sign(r.cashFlowNoLoan)}">${money(r.cashFlowNoLoan)}</b></div>
      <div><span>Yearly return on cost</span><b>${r.capRate}%</b></div>
      <div><span>Monthly profit after refinancing</span><b class="${sign(r.cashFlowAfterRefi)}">${money(r.cashFlowAfterRefi)}</b></div>
      <div><span>Investor's cash left in</span><b>${r.cashLeftIn <= 0 ? 'None' : money(r.cashLeftIn)}</b></div>
    </div>
    ${r.flags.map((f) => `<p class="flag ${f.level}">${esc(f.text)}</p>`).join('')}`;
}

function renderCancelExplain() {
  const el = $('#cancel-explain');
  if (!el) return;
  const days = state.terms.inspectionDays || 0;
  el.innerHTML = `For <b>${plural(days, 'day')}</b> after signing, you can cancel for any reason and get your <b>${money(state.inputs.earnestMoney)}</b> deposit back. After that, the most you can lose is the deposit. Use those days to find your investor.`;
}

function renderComps(c) {
  const line = (title, x, unit) => (x ? `<p><b>${title}: about ${money(x.estimate)}${unit}</b> <span class="muted">(${money(x.low)} to ${money(x.high)}${unit})</span></p>` : `<p class="muted">${title}: no estimate found</p>`);
  return `<div class="explain">
    ${line('Value today', c.value, '')}
    ${c.value ? '<button class="link" id="use-value" type="button">Use as value after repairs</button>' : ''}
    ${line('Rent', c.rent, ' a month')}
    <p class="muted small">From ${esc(c.source)}, ${esc(c.checkedAt)}. This is the value as it is now; after repairs it may be higher.</p>
  </div>`;
}

async function checkComps(btn) {
  btn.disabled = true;
  btn.textContent = 'Checking…';
  try {
    const updated = await api(`/api/deals/${encodeURIComponent(state.deal.id)}/comps`, { method: 'POST' });
    state.deal = { ...state.deal, comps: updated.comps, estimatedRent: updated.estimatedRent };
    $('#comps-out').innerHTML = renderComps(updated.comps);
    refresh();
  } catch (err) {
    $('#comps-out').innerHTML = `<p class="flag bad">${esc(err.message)}</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Check value & rent online';
  }
}

// ---------- status (pipeline) ----------
async function renderStatusExtra() {
  const stage = $('#p-stage').value;
  const p = state.deal.pipeline || {};
  const date = (key, label) => `<label class="field compact"><span class="field-label">${label}</span><input type="date" data-pipe="${key}" id="p-${key}" value="${esc(p[key] || '')}"></label>`;
  let html = '';
  if (stage === 'offer') html = date('offerDate', 'Sent on');
  if (stage === 'contract') html = date('contractDate', 'Contract signed on') + date('closingDate', 'Closing date');
  if (stage === 'assigned') html = `<label class="field compact"><span class="field-label">Investor</span><select data-pipe="buyerId" id="p-buyerId"><option value="">Choose…</option></select></label>` + date('closingDate', 'Closing date');
  $('#status-extra').innerHTML = html;
  if (stage === 'assigned') {
    const buyers = await api('/api/buyers');
    const sel = $('#p-buyerId');
    if (!sel) return;
    sel.innerHTML = '<option value="">Choose…</option>' + buyers.map((b) => `<option value="${esc(b.id)}">${esc(b.name.replace(/^Sample Buyer: /, ''))}</option>`).join('');
    sel.value = p.buyerId || '';
  }
}

async function saveStatus() {
  const val = (k) => $(`#p-${k}`)?.value;
  const body = {
    stage: $('#p-stage').value,
    contractPrice: state.inputs.contractPrice,
    buyerPrice: state.inputs.buyerPrice,
    earnestMoney: state.inputs.earnestMoney,
    inspectionDays: state.terms.inspectionDays,
  };
  for (const k of ['offerDate', 'contractDate', 'closingDate', 'buyerId']) if (val(k) !== undefined) body[k] = val(k);
  try {
    const updated = await api(`/api/deals/${encodeURIComponent(state.deal.id)}/pipeline`, { method: 'PATCH', body });
    state.deal = { ...state.deal, pipeline: updated.pipeline };
    const i = state.deals.findIndex((x) => x.id === updated.id);
    if (i !== -1) state.deals[i] = { ...state.deals[i], pipeline: updated.pipeline };
    renderList();
    $('#p-saved').textContent = 'Saved';
    setTimeout(() => { const s = $('#p-saved'); if (s) s.textContent = ''; }, 1500);
  } catch (err) {
    $('#p-saved').textContent = err.message;
  }
}

// ---------- add deals ----------
const addDialog = $('#add-dialog');
function showAddPanel(name) {
  $('#add-choices').hidden = Boolean(name);
  $$('[data-panel]', addDialog).forEach((p) => (p.hidden = p.dataset.panel !== name));
  $('#add-title').textContent = { upload: 'Upload a county list', one: 'Add one property', auto: 'Pull a list every day' }[name] || 'Add deals';
  if (name === 'auto') loadSources();
}
$('#add-deals-btn').addEventListener('click', () => {
  showAddPanel(null);
  $('#upload-result').innerHTML = '';
  openDialog(addDialog);
});
addDialog.addEventListener('click', (e) => {
  const c = e.target.closest('[data-choice]');
  if (c) showAddPanel(c.dataset.choice);
  if (e.target.closest('[data-back]')) showAddPanel(null);
});

$('#upload-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = $('#upload-file').files[0];
  const out = $('#upload-result');
  if (!file) return;
  if (file.size > 5_000_000) {
    out.innerHTML = '<p class="flag bad">That file is over 5 MB. Cut it down to your counties first.</p>';
    return;
  }
  const btn = $('#upload-submit');
  btn.disabled = true;
  btn.textContent = 'Checking every property…';
  try {
    const fd = Object.fromEntries(new FormData(e.target));
    const r = await api('/api/deals/import', {
      method: 'POST',
      body: { csv: await file.text(), defaults: { ...fd, state: (fd.state || '').toUpperCase(), repairPct: Number(fd.repairPct) } },
    });
    const c = r.counts;
    out.innerHTML = `<div class="explain">
      <p><b>Added ${plural(r.added, 'property')}.</b></p>
      <p><span class="tag good">${c.works} good</span> <span class="tag warn">${c.tight} tight</span> <span class="tag bad">${c['does-not-work']} don't work</span> <span class="tag neutral">${c['needs-value']} need a value</span></p>
      ${r.skippedCount ? `<details class="fold-plain"><summary>${plural(r.skippedCount, 'row')} skipped</summary><ul class="small">${r.skipped.map((x) => `<li>Row ${x.row}: ${esc(x.reason)}</li>`).join('')}</ul></details>` : ''}
      ${r.added ? `<button type="button" id="show-good">Show the good deals</button>` : ''}
    </div>`;
    $('#show-good')?.addEventListener('click', () => {
      addDialog.close();
      state.source = r.source;
      state.filter = 'good';
      $$('.chip[data-filter]').forEach((x) => x.classList.toggle('active', x.dataset.filter === 'good'));
      loadDeals();
    });
    loadDeals();
  } catch (err) {
    out.innerHTML = `<p class="flag bad">${esc(err.message)}</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Upload';
  }
});

$('#one-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  body.state = (body.state || '').toUpperCase();
  body.propertyType = 'single-family';
  try {
    const deal = await api('/api/deals', { method: 'POST', body });
    addDialog.close();
    e.target.reset();
    $('#one-error').textContent = '';
    await loadDeals();
    openDeal(deal.id);
  } catch (err) {
    $('#one-error').textContent = err.message;
  }
});

async function loadSources() {
  $('#auto-note').textContent = state.status.autoPull
    ? 'DealFlip downloads each saved link once a day and adds only new properties.'
    : 'Daily pulls start once the full app is online. In this preview, download the file and use "Upload a county list".';
  const list = await api('/api/sources');
  $('#sources-list').innerHTML = list
    .map((s) => {
      const r = s.lastResult;
      const last = !s.lastRun ? 'Not pulled yet' : r?.ok ? `Last pull ${esc(s.lastRun.slice(0, 10))}: ${r.added} new` : `Last pull failed: ${esc(r?.error || '')}`;
      return `<div class="source"><div><b>${esc(s.name)}</b><p class="muted small">${last}</p></div>
        <div class="button-row"><button class="secondary" data-pull="${esc(s.id)}" type="button">Pull now</button><button class="link danger" data-unsource="${esc(s.id)}" type="button">Remove</button></div></div>`;
    })
    .join('');
}
$('#source-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  try {
    await api('/api/sources', { method: 'POST', body: { ...fd, repairPct: Number(fd.repairPct) } });
    e.target.reset();
    $('#source-error').textContent = '';
    loadSources();
  } catch (err) {
    $('#source-error').textContent = err.message;
  }
});
$('#sources-list').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b || !(b.dataset.pull || b.dataset.unsource)) return;
  b.disabled = true;
  try {
    if (b.dataset.pull) {
      b.textContent = 'Pulling…';
      await api(`/api/sources/${encodeURIComponent(b.dataset.pull)}/run`, { method: 'POST' });
      loadDeals();
    } else {
      await api(`/api/sources/${encodeURIComponent(b.dataset.unsource)}`, { method: 'DELETE' });
    }
  } catch (err) {
    $('#source-error').textContent = err.message;
  }
  loadSources();
});

// ---------- progress ----------
async function loadProgress() {
  const s = await api('/api/pipeline');
  const g = s.goal;
  const lined = s.totals.closed + s.totals.assigned + s.totals.contract;
  $('#goal-lined').textContent = money(lined);
  $('#goal-total').textContent = money(g.amount);
  $('#bar-paid').style.width = `${g.closedPct}%`;
  $('#bar-signed').style.width = `${g.assignedPct}%`;
  $('#bar-contract').style.width = `${g.contractPct}%`;
  $('#sum-paid').textContent = money(s.totals.closed);
  $('#sum-signed').textContent = money(s.totals.assigned);
  $('#sum-contract').textContent = money(s.totals.contract);
  $('#goal-note').textContent = [
    g.deadline ? (g.daysLeft >= 0 ? `${plural(g.daysLeft, 'day')} left.` : `The deadline passed ${plural(-g.daysLeft, 'day')} ago.`) : '',
    g.remaining > 0 ? `${money(g.remaining)} still to find.` : 'Your goal is covered if these deals close.',
    'Money only arrives when a deal closes.',
  ].filter(Boolean).join(' ');
  $('#goal-amount').value = g.amount;
  $('#goal-deadline').value = g.deadline;

  $('#alerts').innerHTML = s.alerts.length
    ? s.alerts.map((a) => `<li><button class="todo-item ${a.level}" data-deal="${esc(a.dealId)}" type="button">${esc(a.text)}</button></li>`).join('')
    : '<li class="empty-small">Nothing urgent. Keep making offers.</li>';

  const groups = s.stages.filter((st) => st.id !== 'lead' && s.columns[st.id].length);
  $('#by-status').innerHTML = groups.length
    ? groups
        .map((st) => `<div class="status-group"><h3>${esc(st.label)} <span class="muted">${s.columns[st.id].length}</span></h3>
          ${s.columns[st.id].map((c) => `<button class="row-link" data-deal="${esc(c.id)}" type="button"><span><b>${esc(c.address)}</b><span class="muted small">${esc(c.when || [c.city, c.state].filter(Boolean).join(', '))}</span></span>${c.fee ? `<span class="fee">${money(c.fee)}</span>` : ''}</button>`).join('')}
        </div>`)
        .join('')
    : '<p class="empty-small">No deals in progress yet. Open a deal and change its <b>Status</b> when you send an offer.</p>';
  loadChecklist();
}

async function openFromProgress(id) {
  showView('deals');
  if (!state.deals.length) await loadDeals();
  openDeal(id);
}
$('#alerts').addEventListener('click', (e) => { const b = e.target.closest('[data-deal]'); if (b) openFromProgress(b.dataset.deal); });
$('#by-status').addEventListener('click', (e) => { const b = e.target.closest('[data-deal]'); if (b) openFromProgress(b.dataset.deal); });
$('#edit-goal').addEventListener('click', () => { $('#goal-form').hidden = !$('#goal-form').hidden; });
$('#goal-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await api('/api/settings/goal', { method: 'PUT', body: { amount: Number($('#goal-amount').value) || 0, deadline: $('#goal-deadline').value } });
  $('#goal-form').hidden = true;
  loadProgress();
});

async function loadChecklist() {
  renderChecklist(await api('/api/checklist'));
}
function renderChecklist(c) {
  $('#checklist-count').textContent = `${c.done} of ${c.total} done`;
  $('#checklist-bar').style.width = `${Math.round((c.done / c.total) * 100)}%`;
  $('#checklist').innerHTML = c.groups
    .map((g) => `<h3>${esc(g.group)}</h3>${g.items.map((i) => `<div class="check-item ${i.done ? 'done' : ''}">
        <input type="checkbox" id="chk-${esc(i.id)}" data-check="${esc(i.id)}" ${i.done ? 'checked' : ''}>
        <label for="chk-${esc(i.id)}"><b>${esc(i.title)}</b><span class="muted small">${esc(i.hint)}</span></label>
        <input class="note" id="note-${esc(i.id)}" data-note="${esc(i.id)}" value="${esc(i.note)}" placeholder="Notes" aria-label="Notes for ${esc(i.title)}">
      </div>`).join('')}`)
    .join('');
}
$('#checklist').addEventListener('change', async (e) => {
  const t = e.target;
  const body = t.dataset.check ? { id: t.dataset.check, done: t.checked } : t.dataset.note ? { id: t.dataset.note, note: t.value } : null;
  if (!body) return;
  const c = await api('/api/checklist', { method: 'PUT', body });
  if (body.done !== undefined) renderChecklist(c);
});

// ---------- investors ----------
async function loadInvestors() {
  const buyers = await api('/api/buyers');
  $('#investor-list').innerHTML = buyers.length
    ? buyers
        .map((b) => `<div class="investor card">
          <div class="match-top"><b>${esc(b.name.replace(/^Sample Buyer: /, ''))}</b>${b.sample ? '<span class="tag neutral">Sample</span>' : b.signup ? '<span class="tag good">Signed up</span>' : ''}</div>
          <p class="muted small">${esc([b.contact, b.phone].filter(Boolean).join(' · '))}</p>
          <dl class="facts">
            <div><dt>Buys in</dt><dd>${esc([...(b.counties || []), ...(b.states || [])].join(', ') || '—')}</dd></div>
            <div><dt>Price</dt><dd>${money(b.minPrice)} to ${b.maxPrice ? money(b.maxPrice) : 'any'}</dd></div>
            <div><dt>Repairs</dt><dd>${esc((b.rehabLevels || []).join(', ') || '—')}</dd></div>
            ${b.strategies?.length ? `<div><dt>Does</dt><dd>${esc(b.strategies.map((x) => (x === 'rental' ? 'rentals' : 'flips')).join(', '))}</dd></div>` : ''}
          </dl>
          ${b.sample ? '' : `<button class="link danger" data-del="${esc(b.id)}" type="button">Remove</button>`}
        </div>`)
        .join('')
    : '<p class="empty-small">No investors yet. Add the ones you talk to, or send them the questions above.</p>';
}
$('#investor-list').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-del]');
  if (!b) return;
  if (b.dataset.confirm !== 'yes') {
    b.dataset.confirm = 'yes';
    b.textContent = 'Tap again to remove';
    return;
  }
  await api(`/api/buyers/${encodeURIComponent(b.dataset.del)}`, { method: 'DELETE' });
  loadInvestors();
});
$('#add-investor-btn').addEventListener('click', () => openDialog($('#investor-dialog')));
$('#investor-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd);
  body.rehabLevels = fd.getAll('rehabLevels');
  body.strategies = fd.getAll('strategies');
  body.proofOfFunds = fd.has('proofOfFunds');
  body.states = (body.states || '').toUpperCase();
  try {
    await api('/api/buyers', { method: 'POST', body });
    e.target.reset();
    $('#investor-error').textContent = '';
    $('#investor-dialog').close();
    loadInvestors();
    if (state.deal) refresh();
  } catch (err) {
    $('#investor-error').textContent = err.message;
  }
});

const SIGNUP_QUESTIONS = `Hi! I'm putting together a list of investors to send off-market deals to first. So I only send what fits you:

1. Which states and counties (or cities) do you buy in?
2. What price range?
3. What kind of houses: single-family, duplex, small apartment buildings?
4. How much repair work will you take on: light, medium or heavy?
5. Do you fix and sell, keep them as rentals, or both?
6. How many days do you need to close, and can you show proof of funds?
7. Anything you avoid, or a minimum profit you need?`;

function setupInvite() {
  const online = location.protocol.startsWith('http') && !/claude\.ai$|claudeusercontent\.com$/.test(location.hostname);
  $('#invite-online').hidden = !online;
  $('#invite-offline').hidden = online;
  if (online) $('#signup-link').textContent = `${location.origin}/join`;
  $('#signup-questions').textContent = SIGNUP_QUESTIONS;
}
$('#copy-signup-link').addEventListener('click', (e) => copyText($('#signup-link').textContent, e.target, $('#signup-link')));
$('#copy-questions').addEventListener('click', (e) => {
  $('#signup-questions').closest('details').open = true;
  copyText(SIGNUP_QUESTIONS, e.target, $('#signup-questions'));
});

// ---------- start ----------
async function start() {
  setupInvite();
  if (typeof resetPreview === 'function') {
    const r = $('#reset-preview');
    r.hidden = false;
    r.addEventListener('click', resetPreview);
  }
  state.status = await api('/api/status').catch(() => ({}));
  await loadDeals();
  // On a wide screen, open the best deal so the page starts with an answer.
  if (window.matchMedia('(min-width: 861px)').matches && !state.deal) {
    const best = visibleDeals()[0];
    if (best) openDeal(best.id);
  }
}
start();
