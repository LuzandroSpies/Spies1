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
    $('#view-deals').classList.toggle('hidden', btn.dataset.view !== 'deals');
    $('#view-buyers').classList.toggle('hidden', btn.dataset.view !== 'buyers');
    if (btn.dataset.view === 'buyers') loadBuyers();
  }),
);

// ---------- AI status ----------
api('/api/status').then((s) => {
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
  state.deals = await api(`/api/deals?${params}`);
  renderDealList();
}

async function fillStateFilter() {
  const all = await api('/api/deals');
  const states = [...new Set(all.map((d) => d.state).filter(Boolean))].sort();
  const sel = $('#f-state');
  const current = sel.value;
  sel.innerHTML = '<option value="">All states</option>' + states.map((s) => `<option>${esc(s)}</option>`).join('');
  sel.value = current;
}

function renderDealList() {
  const ul = $('#deal-list');
  if (!state.deals.length) {
    ul.innerHTML = '<li class="muted">No deals match these filters.</li>';
    return;
  }
  ul.innerHTML = state.deals
    .map((d) => {
      const tax = /tax/i.test(d.saleType);
      return `<li class="deal-item ${state.deal?.id === d.id ? 'active' : ''}" data-id="${esc(d.id)}">
        <div class="addr">${esc(d.address)}</div>
        <div class="meta">${esc(d.city)}, ${esc(d.state)} · ${esc(d.beds)} bd / ${esc(d.baths)} ba · ${esc(d.sqft)} sqft</div>
        <div><span class="tag ${tax ? 'tax' : ''}">${esc(d.saleType)}</span>${d.sample ? '<span class="tag">Sample</span>' : ''}
          <span class="tag verdict-${esc(d.quick.verdict)}">${verdictLabel(d.quick.verdict)}</span></div>
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
['#f-type', '#f-state'].forEach((s) => $(s).addEventListener('change', loadDeals));
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
  };
  state.terms = { closingDays: 30, inspectionDays: 10, sellerCredits: 0, assignable: true, buyerName: '' };
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
      <div class="card">
        <h3><span class="num">1</span>Check the numbers</h3>
        <p class="muted">The listing's "worth" figure is only an estimate. Replace it with sold comps.</p>
        ${slider('arv', 'After-repair value (ARV)', arvMax, 1000)}
        <div class="two">
          ${numberField('repairs', 'Repairs')}
          ${numberField('titleAndLiens', 'Title / liens / back taxes')}
        </div>
      </div>

      <div class="card">
        <h3><span class="num">2</span>Get it under contract</h3>
        ${slider('contractPrice', 'Your offer / contract price', Math.max(d.askingPrice * 3, 20000), 100)}
        <div class="two">
          ${numberField('closingDays', 'Close in (days)', 'terms')}
          ${numberField('inspectionDays', 'Inspection period (days)', 'terms')}
          ${numberField('earnestMoney', 'Earnest money')}
          ${numberField('sellerCredits', 'Seller credits', 'terms')}
        </div>
        <label class="field"><span>Your name or company</span><input data-term="buyerName" placeholder="Shown as the buyer on the letter"></label>
        <label class="field" style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-term="assignable" checked> Buyer is "name and/or assigns" (lets you assign the contract)</label>
        <button id="draft-offer">Draft offer letter</button>
        <div id="offer-out"></div>
      </div>

      <div class="card">
        <h3><span class="num">3</span>Get cash buyers</h3>
        ${slider('buyerPrice', 'Price you ask your cash buyer', arvMax, 500)}
        <div class="muted" id="buyer-max-hint"></div>
        ${numberField('yourCosts', 'Your marketing & closing costs')}
        <div id="buyer-matches"></div>
        <div id="outreach-out"></div>
      </div>

      <div class="card">
        <h3><span class="num">4</span>AI deal review</h3>
        <p class="muted">A second opinion on the numbers, the risks for this sale type, and what to verify first.</p>
        <button id="ai-review">Review this deal</button>
        <div id="review-out"></div>
      </div>

    </div>`;

  $('#draft-offer').addEventListener('click', draftOffer);
  $('#ai-review').addEventListener('click', review);
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
  } else if (t.dataset.term) {
    state.terms[t.dataset.term] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Number(t.value) || 0 : t.value;
  }
}

async function refresh() {
  const d = state.deal;
  if (!d) return;
  const id = encodeURIComponent(d.id);
  const [a, matches] = await Promise.all([
    api(`/api/deals/${id}/analyze`, { method: 'POST', body: state.inputs }),
    api(`/api/deals/${id}/buyers`, { method: 'POST', body: { price: state.inputs.buyerPrice } }),
  ]);
  if (state.deal !== d) return; // user switched deals mid-request
  state.analysis = a;
  renderResults(a);
  renderMatches(matches);
}

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
        <button class="secondary" data-outreach="${esc(m.buyer.id)}">Draft email</button>
      </div>`,
    )
    .join('');
  box.querySelectorAll('[data-outreach]').forEach((b) => b.addEventListener('click', () => outreach(b.dataset.outreach, b)));
}

async function runAi(button, target, path, body) {
  button.disabled = true;
  const old = button.textContent;
  button.textContent = 'Working…';
  try {
    const r = await api(path, { method: 'POST', body });
    const note = r.ai ? '' : `<span class="note">Template draft${r.note ? ` (${esc(r.note)})` : ''}</span>`;
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
    <thead><tr><th>Name</th><th>Where</th><th>Price range</th><th>Buys</th><th>POF</th><th></th></tr></thead>
    <tbody>${buyers
      .map(
        (b) => `<tr>
          <td><b>${esc(b.name)}</b><div class="muted">${esc(b.contact)}</div></td>
          <td>${esc((b.states || []).join(', '))}<div class="muted">${esc((b.counties || []).join(', '))}</div></td>
          <td>${money(b.minPrice)}–${money(b.maxPrice)}</td>
          <td>${esc((b.propertyTypes || []).join(', '))}<div class="muted">${esc((b.rehabLevels || []).join(', '))} rehab</div></td>
          <td>${b.proofOfFunds ? 'Yes' : 'No'}</td>
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
