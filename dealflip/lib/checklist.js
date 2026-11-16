'use strict';

// Getting set up to do deals from outside the US. Progress is saved in settings.checklist.
const CHECKLIST = [
  {
    group: 'Business setup',
    items: [
      { id: 'structure', title: 'Decide who owns the business', hint: 'You alone with your brother helping, or the two of you as partners. Both owners are named to the bank either way.' },
      { id: 'tax-adviser', title: 'Book a call with a US–South Africa tax adviser', hint: 'Ask about the 15% FIRPTA withholding on assignment fees, US filings for a foreign-owned LLC, and how SARS taxes this income.' },
      { id: 'llc', title: 'Form the LLC', hint: 'Your brother can file it and act as registered agent. Note the state and LLC name here.' },
      { id: 'operating-agreement', title: 'Sign an operating agreement', hint: 'Who owns what, who does what, how profits are split, and what happens if one of you wants out.' },
      { id: 'ein', title: 'Get the EIN (US tax ID) for the LLC', hint: 'Free from the IRS. Online only if the responsible party has a US SSN or ITIN; otherwise by fax or mail.' },
      { id: 'bank', title: 'Open the US business bank account', hint: 'Every owner of 25% or more is identified. Assignment fees get wired here.' },
    ],
  },
  {
    group: 'Deal team',
    items: [
      { id: 'counties', title: 'Pick 1–2 target counties', hint: 'Where several of your investors already buy.' },
      { id: 'buyers', title: 'Add your investors on the Investors tab', hint: 'Where they buy, cash or creative, the most cash they bring, the cash flow they need, and proof of funds.' },
      { id: 'title-company', title: 'Find a title company that handles assignments and creative deals', hint: 'Ask: Do you close subject-to and seller-finance deals? Accept a South African passport and remote notarization? Wire to a foreign-owned LLC? Withhold FIRPTA on assignment fees?' },
      { id: 'servicer', title: 'Pick a loan servicing company for creative deals', hint: 'A third party that collects the investor\'s payments and pays the seller\'s loan, so the seller can always see the payments are made.' },
      { id: 'attorney', title: 'Have an attorney review your two contracts', hint: 'Purchase agreement and assignment agreement, for the state you work in.' },
      { id: 'state-rules', title: "Check the state's wholesaling rules", hint: 'Some states require a license or disclosures for wholesaling, and some strictly regulate subject-to, seller financing, wraps and buying from owners who are behind on payments.' },
      { id: 'notary', title: 'Set up a way to sign and notarize from South Africa', hint: 'Remote online notary, the US Consulate (Johannesburg, Cape Town, Durban), or a local notary plus apostille. Or your brother signs in person as manager.' },
    ],
  },
  {
    group: 'First deals',
    items: [
      { id: 'lead-list', title: "Get your county's tax-delinquent or tax-sale list and import it", hint: 'Deals tab, Import a list.' },
      { id: 'first-offers', title: 'Send your first 10 offers', hint: 'Only at prices that still work for your investors. Mark each one "Offer sent" so follow-ups get flagged.' },
    ],
  },
];

const ITEM_IDS = CHECKLIST.flatMap((g) => g.items.map((i) => i.id));

function withProgress(saved = {}) {
  const groups = CHECKLIST.map((g) => ({
    group: g.group,
    items: g.items.map((i) => ({ ...i, done: Boolean(saved[i.id]?.done), note: saved[i.id]?.note || '' })),
  }));
  const done = groups.reduce((n, g) => n + g.items.filter((i) => i.done).length, 0);
  return { groups, done, total: ITEM_IDS.length };
}

function updateItem(saved = {}, { id, done, note } = {}) {
  if (!ITEM_IDS.includes(id)) throw new Error('Unknown checklist item');
  const prev = saved[id] || {};
  return {
    ...saved,
    [id]: {
      done: done === undefined ? Boolean(prev.done) : Boolean(done),
      note: note === undefined ? prev.note || '' : String(note).slice(0, 300),
    },
  };
}

module.exports = { CHECKLIST, withProgress, updateItem };
