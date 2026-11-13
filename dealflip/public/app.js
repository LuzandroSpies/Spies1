'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const money = (n) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(Number(n) || 0)).toLocaleString('en-US')}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const state = { deals: [], deal: null, inputs: {}, terms: {}, analysis: null };

// ---------- tabs ----------
document.querySelectorAll('.tab').forEach((btn) =>
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
    showView(btn.dataset.view);
  }),
);

function showView(view) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  for (const v of ['deals', 'pipeline', 'buyers']) $(`#view-${v}`).classList.toggle('hidden', v !== view);
  if (view === 'buyers') loadBuyers();
  if (view === 'pipeline') { loadPipeline(); loadChecklist(); }
}

// ---------- AI status ----------
api('/api/status').then((s) => {
  state.status = s;
  $('#sources-note').textContent = s.autoPull ? 'DealFlip pulls each saved link once a day and adds new properties.' : 'Saved links are pulled automatically once the full app is online. In this preview, download the file and use the upload above.';
  const pill = $('#ai-status');
  pill.textContent = s.ai ? 'AI: Claude connected' : 'AI: templates (no API key)';
  pill.classList.toggle('on', s.ai);
  pill.title = s.ai ? `Model: ${s.model}` : 'Set ANTHROPIC_API_KEY to turn on AI drafting and reviews.';
});

// ---------- deal list ----------
async function loadDeals() {
  const params = new URLSearchParams();
  if ($('#f-type').value) params.set('saleType', $('#f-type').value);
  if ($('#f-state').value) params.set('state', $('#f-state').value);
  if ($('#f-max').value) params.set('maxPrice', $('#f-max').value);
  if ($('#f-source').value) params.set('source', $('#f-source').value);
  if ($('#f-works').checked) params.set('verdict', 'works');
  const deals = await api(`/api/deals?${params}`);
  // Best opportunities first: deals that work, by the fee a 70%-rule buyer leaves you.
  const rank = { works: 0, tight: 1, 'does-not-work': 2 };
  state.deals = deals.sort((a, b) => (a.estimatedValue > 0 ? 0 : 1) - (b.estimatedValue > 0 ? 0 : 1)
    || rank[a.quick.verdict] - rank[b.quick.verdict] || b.quick.realisticFee - a.quick.realisticFee);
  renderDealList();
}

async function fillStateFilter() {
  const all = await api('/api/deals');
  const fill = (sel, label, values) => {
    const current = sel.value;
    sel.innerHTML = `<option value="">${label}</option>` + values.map((v) => `<option>${esc(v)}</option>`).join('');
    sel.value = values.includes(current) ? current : '';
  };
  fill($('#f-state'), 'All states', [...new Set(all.map((d) => d.state).filter(Boolean))].sort());
  fill($('#f-source'), 'All lists', [...new Set(all.map((d) => d.source || 'Sample'))].sort());
}

const LIST_LIMIT = 200;

function renderDealList() {
  const ul = $('#deal-list');
  if (!state.deals.length) {
    ul.innerHTML = '<li class="muted">No deals match these filters.</li>';
    $('#deal-count').textContent = '';
    return;
  }
  const n = state.deals.length;
  $('#deal-count').textContent = n > LIST_LIMIT ? `Showing the top ${LIST_LIMIT} of ${n} deals. Use the filters to narrow it down.` : `${n} deal${n === 1 ? '' : 's'}`;
  ul.innerHTML = state.deals
    .slice(0, LIST_LIMIT)
    .map((d) => {
      const tax = /tax/i.test(d.saleType);
      return `<li class="deal-item ${state.deal?.id === d.id ? 'active' : ''}" data-id="${esc(d.id)}">
        <div class="addr">${esc(d.address)}</div>
        <div class="meta">${esc([`${d.city || ''}${d.state ? `, ${d.state}` : ''}`, d.beds ? `${d.beds} bd / ${d.baths} ba` : '', d.sqft ? `${d.sqft} sqft` : ''].filter(Boolean).join(' · '))}</div>
        <div><span class="tag ${tax ? 'tax' : ''}">${esc(d.saleType)}</span>${d.sample ? '<span class="tag">Sample</span>' : ''}
          ${d.estimatedValue > 0 ? `<span class="tag verdict-${esc(d.quick.verdict)}">${verdictLabel(d.quick.verdict)}</span>` : '<span class="tag">Needs value</span>'}
          ${d.pipeline?.stage ? `<span class="tag stage-tag">${esc(stageLabel(d.pipeline.stage))}</span>` : ''}</div>
        <div class="nums"><span>Price <b>${money(d.askingPrice)}</b></span><span>Est. value <b>${money(d.estimatedValue)}</b></span></div>
      </li>`;
    })
    .join('');
}

function verdictLabel(v) {
  return { works: 'Works on paper', tight: 'Tight', 'does-not-work': "Doesn't work" }[v] || v;
}

$('#deal-list').addEventListener('click', (e) => {
  const li = e.target.closest('.deal-item');
  if (li) openDeal(li.dataset.id);
});
['#f-type', '#f-state', '#f-source', '#f-works'].forEach((s) => $(s).addEventListener('change', loadDeals));
$('#f-max').addEventListener('input', debounce(loadDeals, 300));

// ---------- deal detail ----------
async function openDeal(id) {
  const deal = state.deals.find((d) => d.id === id) || (await api(`/api/deals/${encodeURIComponent(id)}`));
  state.deal = deal;
  const first = deal.quick || (await api(`/api/deals/${encodeURIComponent(id)}/analyze`, { method: 'POST', body: {} }));
  state.inputs = {
    arv: deal.estimatedValue,
    repairs: deal.estimatedRepairs,
    titleAndLiens: deal.titleAndLiens,
    contractPrice: deal.askingPrice,
    // Start the buyer price at what a 70%-rule investor would actually pay, not a wishful number.
    buyerPrice: Math.max(deal.askingPrice, first.buyerMaxPrice),
    yourCosts: 500,
    earnestMoney: Math.min(1000, Math.round(deal.askingPrice * 0.05)),
    ...trackedInputs(deal),
  };
  const keep = state.terms || {};
  state.terms = {
    closingDays: 30, inspectionDays: deal.pipeline?.inspectionDays || 10, sellerCredits: 0, assignable: true,
    sellerName: deal.ownerName || '', assigneeDeposit: 1000,
    buyerName: keep.buyerName || '', titleCompany: keep.titleCompany || '', // yours, so they carry over between deals
  };
  state.rental = {};
  renderDealList();
  renderDetail();
  await refresh();
}

function slider(key, label, max, step = 500) {
  const v = state.inputs[key];
  return `<div class="field">
    <div class="row"><span>${label}</span><span class="val" id="v-${key}">${money(v)}</span></div>
    <input type="range" data-key="${key}" min="0" max="${Math.max(max, v)}" step="${step}" value="${v}">
  </div>`;
}

function numberField(key, label, scope = 'inputs') {
  return `<label class="field"><span>${label}</span>
    <input type="number" min="0" data-${scope === 'inputs' ? 'key' : 'term'}="${key}" value="${state[scope][key]}"></label>`;
}

function renderDetail() {
  const d = state.deal;
  const arvMax = Math.max(d.estimatedValue * 1.5, 50000);
  const tax = /tax/i.test(d.saleType);
  $('#detail').innerHTML = `
    <h2>${esc(d.address)}, ${esc(d.city)}, ${esc(d.state)}</h2>
    <div class="muted">${esc(d.saleType)}${d.saleDate ? ` · sale date ${esc(d.saleDate)}` : ''} · ${esc(d.propertyType)} · built ${esc(d.yearBuilt)} · ${esc(d.condition)} rehab</div>
    ${d.notes ? `<p>${esc(d.notes)}</p>` : ''}
    ${tax ? `<ul class="flags"><li class="warn">Tax sale: county tax deed and tax lien sales are usually auctions. You bid, pay in full within days, and generally can't assign the purchase. Assignment only works if you contract with the owner <i>before</i> the sale, and some properties have a redemption period. Check the county's rules.</li></ul>` : ''}
    ${!d.sample ? `<button class="secondary" id="delete-deal">Delete deal</button>` : ''}

    <div class="steps">
      <div class="card results">
        <h3>What you'd actually make</h3>
        <div id="results"></div>
      </div>
      <div class="card results" id="track-card">
        <h3>Track this deal</h3>
        <div class="track-grid">
          <label class="field"><span>Stage</span><select id="p-stage">${STAGES.map((st) => `<option value="${st.id}">${st.label}</option>`).join('')}<option value="">Not tracked</option></select></label>
          <label class="field"><span>Offer sent</span><input id="p-offerDate" type="date"></label>
          <label class="field"><span>Contract signed</span><input id="p-contractDate" type="date"></label>
          <label class="field"><span>Closing date</span><input id="p-closingDate" type="date"></label>
          <label class="field"><span>Buyer who signed</span><select id="p-buyerId"><option value="">None yet</option></select></label>
        </div>
        <div class="row-start" style="align-items:center">
          <button id="p-save">Save to pipeline</button>
          <span class="muted small">Saves the contract price, buyer price, earnest money and free-look days you've set below.</span>
          <span class="track-saved" id="p-saved"></span>
        </div>
      </div>

      <div class="card">
        <h3><span class="num">1</span>Check the numbers</h3>
        <p class="muted">The listing's "worth" figure is only an estimate. Replace it with sold comps.</p>
        ${slider('arv', 'After-repair value (ARV)', arvMax, 1000)}
        <div class="two">
          ${numberField('repairs', 'Repairs')}
          ${numberField('titleAndLiens', 'Title / liens / back taxes')}
        </div>
        <button class="secondary" id="comps-btn" ${state.status?.comps ? '' : 'disabled'}>Check value &amp; rent</button>
        <div class="muted small" id="comps-hint">${state.status?.comps ? 'Uses RentCast: an estimate plus nearby comparable properties.' : 'Value and rent checks switch on in the full app once it is online with a free RentCast key.'}</div>
        <div id="comps-out">${d.comps ? renderComps(d.comps) : ''}</div>
      </div>

      <div class="card">
        <h3><span class="num">2</span>Get it under contract</h3>
        ${slider('contractPrice', 'Your offer / contract price', Math.max(d.askingPrice * 3, 20000), 100)}
        <div class="two">
          ${numberField('closingDays', 'Close in (days)', 'terms')}
          ${numberField('inspectionDays', 'Free-look period (days)', 'terms')}
          ${numberField('earnestMoney', 'Earnest money')}
          ${numberField('sellerCredits', 'Seller credits', 'terms')}
        </div>
        <label class="field"><span>Your name or company</span><input id="t-buyerName" data-term="buyerName" placeholder="You, as buyer" value="${esc(state.terms.buyerName)}"></label>
        <div class="two">
          <label class="field"><span>Seller's name</span><input id="t-sellerName" data-term="sellerName" placeholder="Owner of record" value="${esc(state.terms.sellerName)}"></label>
          <label class="field"><span>Title company</span><input id="t-titleCompany" data-term="titleCompany" placeholder="Holds deposits, runs closing" value="${esc(state.terms.titleCompany)}"></label>
        </div>
        <label class="field" style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-term="assignable" checked> Buyer is "name and/or assigns" (lets you assign the contract)</label>
        <p class="muted">During the free-look period you can cancel for any reason and get your earnest money back. After it, the most you can lose is the earnest money.</p>
        <div class="row-start">
          <button id="draft-offer">Draft offer letter</button>
          <button id="draft-purchase" class="secondary">Purchase agreement</button>
        </div>
        <div id="offer-out"></div>
      </div>

      <div class="card">
        <h3><span class="num">3</span>Get cash buyers</h3>
        ${slider('buyerPrice', 'Price you ask your cash buyer', arvMax, 500)}
        <div class="muted" id="buyer-max-hint"></div>
        <div class="two">
          ${numberField('yourCosts', 'Your marketing & closing costs')}
          ${numberField('assigneeDeposit', "Investor's deposit", 'terms')}
        </div>
        <div id="buyer-matches"></div>
        <div id="outreach-out"></div>
      </div>

      <div class="card">
        <h3><span class="num">4</span>AI deal review</h3>
        <p class="muted">A second opinion on the numbers, the risks for this sale type, and what to verify first.</p>
        <button id="ai-review">Review this deal</button>
        <div id="review-out"></div>
      </div>

      <div class="card results">
        <h3>Rental view (for buy-and-hold buyers)</h3>
        <p class="muted">Many cash buyers keep houses as rentals instead of flipping. These are their numbers at the price you ask them, including a BRRRR refinance (buy, rehab, rent, refinance, repeat).</p>
        <div class="rental-inputs">
          <label class="field"><span>Monthly rent</span><input type="number" min="0" step="25" data-rent="rent" id="r-rent"></label>
          <label class="field"><span>Property tax / year</span><input type="number" min="0" step="100" data-rent="taxesYearly" id="r-taxesYearly"></label>
          <label class="field"><span>Insurance / year</span><input type="number" min="0" step="100" data-rent="insuranceYearly" id="r-insuranceYearly"></label>
          <label class="field"><span>Refinance at (% of ARV)</span><input type="number" min="0" max="100" step="5" data-rent-pct="refiLtv" id="r-refiLtv" value="75"></label>
          <label class="field"><span>Loan rate (%)</span><input type="number" min="0" max="20" step="0.125" data-rent-pct="refiRate" id="r-refiRate" value="7.5"></label>
        </div>
        <div id="rental-out"></div>
      </div>

    </div>`;

  $('#draft-offer').addEventListener('click', draftOffer);
  $('#draft-purchase').addEventListener('click', purchase);
  $('#p-save').addEventListener('click', saveTracking);
  fillTracking();
  $('#ai-review').addEventListener('click', review);
  $('#comps-btn').addEventListener('click', checkComps);
  $('#delete-deal')?.addEventListener('click', deleteDeal);
}

const debouncedRefresh = debounce(refresh, 150);
$('#detail').addEventListener('input', onDetailInput);

function onDetailInput(e) {
  const t = e.target;
  if (t.dataset.key) {
    state.inputs[t.dataset.key] = Number(t.value) || 0;
    const label = $(`#v-${t.dataset.key}`);
    if (label) label.textContent = money(t.value);
    debouncedRefresh();
  } else if (t.dataset.rent || t.dataset.rentPct) {
    const k = t.dataset.rent || t.dataset.rentPct;
    if (t.value === '') delete state.rental[k];
    else state.rental[k] = t.dataset.rentPct ? Number(t.value) / 100 : Number(t.value);
    debouncedRefresh();
  } else if (t.dataset.term) {
    state.terms[t.dataset.term] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Number(t.value) || 0 : t.value;
  }
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
  if (state.deal !== d) return; // user switched deals mid-request
  state.analysis = a;
  renderResults(a);
  renderMatches(matches);
  renderRental(rental);
}

function renderRental(r) {
  // Show the numbers being used as placeholders, so the user sees what to override.
  for (const k of ['rent', 'taxesYearly', 'insuranceYearly']) {
    const el = $(`#r-${k}`);
    if (el && el.value === '') el.placeholder = r.inputs[k];
  }
  const sign = (n) => (n < 0 ? 'neg' : n > 0 ? 'pos' : '');
  $('#rental-out').innerHTML = `
    <span class="tag verdict-${r.verdict}">${verdictLabel(r.verdict)} as a rental</span>
    <span class="muted small">Rent from ${esc(r.rentSource)}</span>
    <div class="stats">
      ${stat('Buyer all-in (price + repairs + closing)', money(r.allIn))}
      ${stat('Cash flow / month, no loan', money(r.cashFlowNoLoan), sign(r.cashFlowNoLoan))}
      ${stat('Cap rate', `${r.capRate}%`)}
      ${stat('Rent as % of all-in (1% rule)', `${r.onePercent}%`)}
      ${stat('Refinance loan', money(r.refiLoan))}
      ${stat('Cash left in after refinance', r.cashLeftIn <= 0 ? `$0 (+${money(-r.cashLeftIn)} back)` : money(r.cashLeftIn), r.cashLeftIn <= 0 ? 'pos' : '')}
      ${stat('Cash flow / month after refinance', money(r.cashFlowAfterRefi), sign(r.cashFlowAfterRefi))}
      ${stat('Cash-on-cash return', r.cashOnCash === null ? 'All cash back' : `${r.cashOnCash}%`)}
    </div>
    ${r.flags.length ? `<ul class="flags">${r.flags.map((f) => `<li class="${f.level}">${esc(f.text)}</li>`).join('')}</ul>` : ''}
    <p class="muted small">Costs assumed: 8% vacancy, 8% maintenance, 10% property management, 5% big repairs, 3% purchase closing, 3% refinance costs, 30-year loan.</p>`;
}

function renderComps(c) {
  const block = (title, x, unit) => (x ? `<div><b>${title}: ${money(x.estimate)}${unit}</b> <span class="muted">(range ${money(x.low)}–${money(x.high)}${unit})</span>
      ${x.comps?.length ? `<ul class="comps">${x.comps.map((k) => `<li>${esc(k.address)}: ${money(k.price)}${unit}${k.beds ? ` · ${k.beds} bd` : ''}${k.sqft ? ` · ${k.sqft} sqft` : ''}${k.distanceMiles !== null ? ` · ${k.distanceMiles} mi` : ''}${k.date ? ` · ${esc(k.date)}` : ''}</li>`).join('')}</ul>` : ''}</div>` : `<div class="muted">${title}: no estimate found</div>`);
  return `<div class="import-summary">
    ${block('Value', c.value, '')}
    ${c.value ? '<button class="secondary" id="use-value">Use this as ARV</button>' : ''}
    ${block('Rent', c.rent, '/mo')}
    <div class="muted small">From ${esc(c.source)} on ${esc(c.checkedAt)}. Comparables can include listings, not only sales. Value is the house as it is now, so the after-repair value may be higher.</div>
  </div>`;
}

async function checkComps(e) {
  const btn = e.target;
  btn.disabled = true;
  btn.textContent = 'Checking…';
  try {
    const updated = await api(`/api/deals/${encodeURIComponent(state.deal.id)}/comps`, { method: 'POST' });
    state.deal = { ...state.deal, comps: updated.comps, estimatedRent: updated.estimatedRent };
    $('#comps-out').innerHTML = renderComps(updated.comps);
    refresh();
  } catch (err) {
    $('#comps-out').innerHTML = `<div class="import-summary">${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Check value & rent';
  }
}

$('#detail').addEventListener('click', (e) => {
  if (e.target.id !== 'use-value' || !state.deal?.comps?.value) return;
  const v = state.deal.comps.value.estimate;
  state.inputs.arv = v;
  const slider = $('input[data-key=arv]');
  if (slider) { slider.max = Math.max(Number(slider.max), v); slider.value = v; }
  $('#v-arv').textContent = money(v);
  refresh();
});

function stat(label, value, cls = '') {
  return `<div class="stat"><div class="label">${label}</div><div class="value ${cls}">${value}</div></div>`;
}

function renderResults(a) {
  $('#buyer-max-hint').textContent = `A 70%-rule investor would pay at most about ${money(a.buyerMaxPrice)}.`;
  const sign = (n) => (n < 0 ? 'neg' : n > 0 ? 'pos' : '');
  $('#results').innerHTML = `
    <span class="tag verdict-${a.verdict}">${verdictLabel(a.verdict)}</span>
    <div class="stats">
      ${stat('Assignment fee (buyer price − contract)', money(a.assignmentFee), sign(a.assignmentFee))}
      ${stat('Your net after your costs', money(a.yourNet), sign(a.yourNet))}
      ${stat('Realistic fee at 70%-rule price', money(a.realisticFee))}
      ${stat('End buyer max (70% rule)', money(a.buyerMaxPrice))}
      ${stat('End buyer all-in', money(a.buyerAllIn))}
      ${stat('End buyer profit', money(a.buyerProfit), sign(a.buyerProfit))}
      ${stat('End buyer margin (of ARV)', `${a.buyerMargin}%`)}
      ${stat('End buyer closing / holding / selling', money(a.buyerOtherCosts))}
    </div>
    ${a.flags.length ? `<ul class="flags">${a.flags.map((f) => `<li class="${f.level}">${esc(f.text)}</li>`).join('')}</ul>` : ''}
    <p class="muted">A fee only gets paid if the deal actually closes. The end buyer's numbers matter as much as yours: if they can't make money, they won't buy.</p>`;
}

function renderMatches(matches) {
  const box = $('#buyer-matches');
  if (!matches.length) {
    box.innerHTML = '<p class="muted">No buyers on your list match this deal. Add buyers in the Cash buyers tab.</p>';
    return;
  }
  box.innerHTML = matches
    .map(
      (m) => `<div class="buyer-match">
        <div class="top-row"><b>${esc(m.buyer.name)}</b><span class="score">${m.score}/100</span></div>
        <div class="why">${esc(m.reasons.join(' · '))}</div>
        <div class="row-start">
          <button class="secondary" data-outreach="${esc(m.buyer.id)}">Draft email</button>
          <button class="secondary" data-assign="${esc(m.buyer.id)}">Assignment agreement</button>
        </div>
      </div>`,
    )
    .join('');
  box.querySelectorAll('[data-outreach]').forEach((b) => b.addEventListener('click', () => outreach(b.dataset.outreach, b)));
  box.querySelectorAll('[data-assign]').forEach((b) => b.addEventListener('click', () => assignment(b.dataset.assign, b)));
}

async function runAi(button, target, path, body) {
  button.disabled = true;
  const old = button.textContent;
  button.textContent = 'Working…';
  try {
    const r = await api(path, { method: 'POST', body });
    const note = r.ai !== false ? '' : `<span class="note">Template draft${r.note ? ` (${esc(r.note)})` : ''}</span>`;
    target.innerHTML = `<div class="ai-out">${note}${esc(r.text)}</div><button class="secondary copy-btn">Copy</button>`;
    target.querySelector('.copy-btn').addEventListener('click', (e) => {
      navigator.clipboard?.writeText(r.text);
      e.target.textContent = 'Copied';
    });
  } catch (err) {
    target.innerHTML = `<div class="ai-out">Error: ${esc(err.message)}</div>`;
  } finally {
    button.disabled = false;
    button.textContent = old;
  }
}

function draftOffer(e) {
  const terms = { ...state.terms, price: state.inputs.contractPrice, earnestMoney: state.inputs.earnestMoney };
  runAi(e.target, $('#offer-out'), `/api/deals/${encodeURIComponent(state.deal.id)}/ai/offer`, { terms, inputs: state.inputs });
}

const STAGES = [
  { id: 'lead', label: 'Lead' }, { id: 'offer', label: 'Offer sent' }, { id: 'contract', label: 'Under contract' },
  { id: 'assigned', label: 'Buyer signed' }, { id: 'closed', label: 'Closed (paid)' }, { id: 'dead', label: 'Dead' },
];
const stageLabel = (id) => STAGES.find((s) => s.id === id)?.label || id;

async function fillTracking() {
  const d = state.deal;
  const p = d.pipeline || {};
  $('#p-stage').value = p.stage || '';
  for (const k of ['offerDate', 'contractDate', 'closingDate']) $(`#p-${k}`).value = p[k] || '';
  const buyers = await api('/api/buyers');
  if (state.deal !== d) return;
  $('#p-buyerId').innerHTML = '<option value="">None yet</option>' + buyers.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('');
  $('#p-buyerId').value = p.buyerId || '';
}

async function saveTracking() {
  const stage = $('#p-stage').value;
  const body = {
    stage: stage || 'lead',
    offerDate: $('#p-offerDate').value,
    contractDate: $('#p-contractDate').value,
    closingDate: $('#p-closingDate').value,
    buyerId: $('#p-buyerId').value,
    contractPrice: state.inputs.contractPrice,
    buyerPrice: state.inputs.buyerPrice,
    earnestMoney: state.inputs.earnestMoney,
    inspectionDays: state.terms.inspectionDays,
  };
  try {
    const updated = await api(`/api/deals/${encodeURIComponent(state.deal.id)}/pipeline`, { method: 'PATCH', body });
    state.deal = { ...state.deal, pipeline: updated.pipeline };
    const i = state.deals.findIndex((x) => x.id === updated.id);
    if (i !== -1) state.deals[i] = { ...state.deals[i], pipeline: updated.pipeline };
    renderDealList();
    $('#p-stage').value = updated.pipeline.stage;
    $('#p-saved').textContent = `Saved: ${stageLabel(updated.pipeline.stage)}, expected fee ${money(updated.pipeline.expectedFee)}`;
  } catch (err) {
    $('#p-saved').textContent = err.message;
  }
}

// When a tracked deal is reopened, start from the numbers saved with it.
function trackedInputs(deal) {
  const p = deal.pipeline;
  if (!p?.stage) return {};
  const out = {};
  for (const k of ['contractPrice', 'buyerPrice', 'earnestMoney']) if (p[k]) out[k] = p[k];
  return out;
}

// ---------- pipeline view ----------
async function loadPipeline() {
  const s = await api('/api/pipeline');
  const g = s.goal;
  $('#goal-amount').value = g.amount;
  $('#goal-deadline').value = g.deadline;
  const lined = s.totals.closed + s.totals.assigned + s.totals.contract;
  $('#goal-summary').textContent = `${money(lined)} of ${money(g.amount)} lined up` +
    (g.deadline ? ` · ${g.daysLeft >= 0 ? `${g.daysLeft} days left` : `deadline passed ${-g.daysLeft} days ago`}` : '') +
    (g.remaining > 0 ? ` · ${money(g.remaining)} still to find` : ' · goal covered if these deals close');
  $('#goal-bar').innerHTML = `<span class="seg-closed" style="width:${g.closedPct}%"></span><span class="seg-assigned" style="width:${g.assignedPct}%"></span><span class="seg-contract" style="width:${g.contractPct}%"></span>`;
  $('#goal-legend').innerHTML = [
    ['seg-closed', 'Paid', s.totals.closed],
    ['seg-assigned', 'Buyer signed (pending closing)', s.totals.assigned],
    ['seg-contract', 'Under contract, no buyer yet', s.totals.contract],
  ].map(([c, l, v]) => `<span><span class="dot ${c}"></span>${l}: <b>${money(v)}</b></span>`).join('');
  $('#alerts').innerHTML = s.alerts.length
    ? s.alerts.map((a) => `<li class="${a.level}" data-deal="${esc(a.dealId)}">${esc(a.text)}</li>`).join('')
    : '<li class="info">Nothing urgent. Keep making offers.</li>';
  $('#board').innerHTML = s.stages.map((st) => {
    const cards = s.columns[st.id];
    const sum = cards.reduce((t, c) => t + c.fee, 0);
    return `<div class="column"><h4><span>${esc(st.label)} (${cards.length})</span>${sum && st.id !== 'dead' ? `<span>${money(sum)}</span>` : ''}</h4>
      ${cards.map((c) => `<button class="pcard" data-deal="${esc(c.id)}"><b>${esc(c.address)}</b>${esc(c.city || '')}${c.state ? `, ${esc(c.state)}` : ''}
        ${c.fee ? `<div class="fee">Fee ${money(c.fee)}</div>` : ''}${c.when ? `<div class="muted">${esc(c.when)}</div>` : ''}</button>`).join('') || '<span class="muted small">None</span>'}
    </div>`;
  }).join('');
}

async function loadChecklist() {
  renderChecklist(await api('/api/checklist'));
}

function renderChecklist(c) {
  $('#checklist-summary').textContent = `${c.done} of ${c.total} done`;
  $('#checklist-bar').style.width = `${Math.round((c.done / c.total) * 100)}%`;
  $('#checklist').innerHTML = c.groups.map((g) => `<div class="check-group"><h3>${esc(g.group)}</h3>
    ${g.items.map((i) => `<div class="check-item ${i.done ? 'done' : ''}">
      <input type="checkbox" id="chk-${esc(i.id)}" data-check="${esc(i.id)}" ${i.done ? 'checked' : ''}>
      <label for="chk-${esc(i.id)}"><div class="title">${esc(i.title)}</div><div class="hint">${esc(i.hint)}</div></label>
      <input class="note" id="note-${esc(i.id)}" data-note="${esc(i.id)}" value="${esc(i.note)}" placeholder="Notes (names, contacts, dates)" aria-label="Notes for ${esc(i.title)}">
    </div>`).join('')}</div>`).join('');
}

$('#checklist').addEventListener('change', async (e) => {
  const t = e.target;
  const body = t.dataset.check ? { id: t.dataset.check, done: t.checked } : t.dataset.note ? { id: t.dataset.note, note: t.value } : null;
  if (!body) return;
  const c = await api('/api/checklist', { method: 'PUT', body });
  if (body.done !== undefined) renderChecklist(c);
  else {
    $('#checklist-summary').textContent = `${c.done} of ${c.total} done · note saved`;
  }
});

async function openFromPipeline(id) {
  showView('deals');
  $('#f-type').value = $('#f-state').value = $('#f-source').value = $('#f-max').value = '';
  $('#f-works').checked = false;
  await loadDeals();
  openDeal(id);
}
$('#board').addEventListener('click', (e) => { const b = e.target.closest('[data-deal]'); if (b) openFromPipeline(b.dataset.deal); });
$('#alerts').addEventListener('click', (e) => { const b = e.target.closest('[data-deal]'); if (b) openFromPipeline(b.dataset.deal); });

$('#goal-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await api('/api/settings/goal', { method: 'PUT', body: { amount: Number($('#goal-amount').value) || 0, deadline: $('#goal-deadline').value } });
  loadPipeline();
});

// ---------- import ----------
const importDialog = $('#import-dialog');
$('#import-btn').addEventListener('click', () => { $('#import-result').innerHTML = ''; importDialog.showModal(); });
$('#import-cancel').addEventListener('click', () => importDialog.close());
$('#import-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = $('#import-file').files[0];
  const out = $('#import-result');
  if (!file) return;
  if (file.size > 5_000_000) { out.innerHTML = '<div class="import-summary">That file is over 5 MB. Split it or filter it to your counties first.</div>'; return; }
  const btn = $('#import-submit');
  btn.disabled = true;
  btn.textContent = 'Importing…';
  try {
    const csv = await file.text();
    const fd = Object.fromEntries(new FormData(e.target));
    const r = await api('/api/deals/import', { method: 'POST', body: { csv, defaults: { ...fd, state: (fd.state || '').toUpperCase(), repairPct: Number(fd.repairPct) } } });
    const c = r.counts;
    out.innerHTML = `<div class="import-summary">
      <b>Added ${r.added} deal${r.added === 1 ? '' : 's'} to "${esc(r.source)}".</b>
      <div>${c.works} work on paper · ${c.tight} tight · ${c['does-not-work']} don't work · ${c['needs-value']} need a value</div>
      <div class="muted small">Columns used: ${esc(Object.entries(r.columns).map(([f, h]) => `${f} ← "${h}"`).join(', '))}</div>
      ${r.skippedCount ? `<div>Skipped ${r.skippedCount} row${r.skippedCount === 1 ? '' : 's'}:</div><ul>${r.skipped.map((x) => `<li>Row ${x.row}: ${esc(x.reason)}</li>`).join('')}</ul>` : ''}
      ${r.added ? '<button type="button" class="secondary" id="import-view">Show the deals that work</button>' : ''}
    </div>`;
    $('#import-view')?.addEventListener('click', async () => {
      importDialog.close();
      await fillStateFilter();
      $('#f-source').value = r.source;
      $('#f-works').checked = true;
      $('#f-type').value = $('#f-state').value = $('#f-max').value = '';
      await loadDeals();
    });
    await fillStateFilter();
    await loadDeals();
  } catch (err) {
    out.innerHTML = `<div class="import-summary">${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Import';
  }
});

function contractTermsNow() {
  return { ...state.terms, price: state.inputs.contractPrice, earnestMoney: state.inputs.earnestMoney };
}

function purchase(e) {
  runAi(e.target, $('#offer-out'), `/api/deals/${encodeURIComponent(state.deal.id)}/contracts/purchase`, { terms: contractTermsNow() });
}

function assignment(buyerId, button) {
  runAi(button, $('#outreach-out'), `/api/deals/${encodeURIComponent(state.deal.id)}/contracts/assignment`, {
    buyerId,
    terms: contractTermsNow(),
    inputs: state.inputs,
  });
}

function review(e) {
  runAi(e.target, $('#review-out'), `/api/deals/${encodeURIComponent(state.deal.id)}/ai/review`, { inputs: state.inputs });
}

function outreach(buyerId, button) {
  runAi(button, $('#outreach-out'), `/api/deals/${encodeURIComponent(state.deal.id)}/ai/outreach`, {
    buyerId,
    price: state.inputs.buyerPrice,
    inputs: state.inputs,
  });
}

async function deleteDeal() {
  if (!confirm('Delete this deal?')) return;
  await api(`/api/deals/${encodeURIComponent(state.deal.id)}`, { method: 'DELETE' });
  state.deal = null;
  $('#detail').innerHTML = '<p class="empty">Deal deleted.</p>';
  await fillStateFilter();
  await loadDeals();
}

// ---------- add deal ----------
const dialog = $('#deal-dialog');
$('#add-deal-btn').addEventListener('click', () => dialog.showModal());
$('#deal-cancel').addEventListener('click', () => dialog.close());
$('#deal-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  body.state = (body.state || '').toUpperCase();
  try {
    const deal = await api('/api/deals', { method: 'POST', body });
    dialog.close();
    e.target.reset();
    await fillStateFilter();
    await loadDeals();
    openDeal(deal.id);
  } catch (err) {
    alert(err.message);
  }
});

// ---------- buyers ----------
async function loadBuyers() {
  const buyers = await api('/api/buyers');
  $('#buyer-table').innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Name</th><th>Where</th><th>Price range</th><th>Buys</th><th>Closes</th><th></th></tr></thead>
    <tbody>${buyers
      .map(
        (b) => `<tr>
          <td><b>${esc(b.name)}</b>${b.signup ? ' <span class="tag stage-tag">Signed up</span>' : ''}<div class="muted">${esc([b.contact, b.phone].filter(Boolean).join(' · '))}</div></td>
          <td>${esc((b.states || []).join(', '))}<div class="muted">${esc((b.counties || []).join(', '))}</div></td>
          <td>${money(b.minPrice)}–${money(b.maxPrice)}</td>
          <td>${esc((b.propertyTypes || []).join(', '))}<div class="muted">${esc((b.rehabLevels || []).join(', '))} rehab${b.strategies?.length ? ` · ${esc(b.strategies.map((x) => (x === 'rental' ? 'rentals' : 'flips')).join(', '))}` : ''}</div></td>
          <td>${b.closeDays ? `${esc(b.closeDays)} days` : '—'}<div class="muted">${b.proofOfFunds ? 'Proof of funds' : 'No proof of funds'}</div></td>
          <td>${b.sample ? '<span class="tag">Sample</span>' : `<button class="secondary" data-del="${esc(b.id)}">Delete</button>`}</td>
        </tr>`,
      )
      .join('')}</tbody></table></div>`;
  document.querySelectorAll('[data-del]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      await api(`/api/buyers/${encodeURIComponent(btn.dataset.del)}`, { method: 'DELETE' });
      loadBuyers();
    }),
  );
}

$('#buyer-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd);
  body.proofOfFunds = fd.has('proofOfFunds');
  body.states = (body.states || '').toUpperCase();
  try {
    await api('/api/buyers', { method: 'POST', body });
    e.target.reset();
    loadBuyers();
    if (state.deal) refresh();
  } catch (err) {
    alert(err.message);
  }
});

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

fillStateFilter();
loadDeals();

// ---------- investor sign-up ----------
const SIGNUP_QUESTIONS = `Hi! I'm building a list of investors to send off-market deals to first. To make sure I only send what fits you:

1. Which states and counties (or cities) do you buy in?
2. What price range?
3. Property types: single-family, duplex, small multi-family, condo, land?
4. Rehab level you'll take on: light, medium or heavy?
5. Do you flip, keep as rentals (buy and hold / BRRRR), or both?
6. How many days do you need to close, and can you show proof of funds?
7. Anything you avoid, or a minimum return you need?`;

function setupSignup() {
  const online = location.protocol.startsWith('http') && !location.hostname.endsWith('claude.ai') && !location.hostname.endsWith('claudeusercontent.com');
  const link = `${location.origin}/join`;
  $('#signup-link-row').hidden = !online;
  if (online) $('#signup-link').textContent = link;
  $('#signup-offline').hidden = online;
  $('#signup-questions').textContent = SIGNUP_QUESTIONS;
}

async function copyText(text, btn, fallbackEl) {
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied';
  } catch {
    const range = document.createRange();
    range.selectNodeContents(fallbackEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    btn.textContent = 'Selected, copy it now';
  }
}
$('#copy-signup-link').addEventListener('click', (e) => copyText($('#signup-link').textContent, e.target, $('#signup-link')));
$('#copy-questions').addEventListener('click', (e) => copyText(SIGNUP_QUESTIONS, e.target, $('#signup-questions')));
setupSignup();

// ---------- saved list links (automatic pulls) ----------
async function loadSources() {
  const list = await api('/api/sources');
  $('#sources-list').innerHTML = list.length
    ? list.map((src) => {
        const r = src.lastResult;
        const last = !src.lastRun ? 'Not pulled yet' : r?.ok ? `Last pull ${esc(src.lastRun.slice(0, 10))}: ${r.added} new` : `Last pull ${esc(src.lastRun.slice(0, 10))} failed: ${esc(r?.error || '')}`;
        return `<div class="source-row"><div><b>${esc(src.name)}</b><div class="muted small">${esc(src.url)}</div><div class="small ${r && !r.ok ? 'bad-text' : 'muted'}">${last}</div></div>
          <div class="row-start"><button class="secondary" data-pull="${esc(src.id)}">Pull now</button><button class="secondary" data-unsource="${esc(src.id)}">Remove</button></div></div>`;
      }).join('')
    : '<div class="muted small">No saved links yet.</div>';
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
  const pull = e.target.dataset.pull;
  const del = e.target.dataset.unsource;
  if (!pull && !del) return;
  e.target.disabled = true;
  try {
    if (pull) {
      e.target.textContent = 'Pulling…';
      await api(`/api/sources/${encodeURIComponent(pull)}/run`, { method: 'POST' });
      await fillStateFilter();
      await loadDeals();
    } else {
      await api(`/api/sources/${encodeURIComponent(del)}`, { method: 'DELETE' });
    }
  } catch (err) {
    $('#source-error').textContent = err.message;
  }
  loadSources();
});
$('#import-btn').addEventListener('click', loadSources);
