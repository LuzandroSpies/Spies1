'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { withProgress, updateItem } = require('../lib/checklist');

test('checklist tracks done items and notes', () => {
  let saved = {};
  assert.strictEqual(withProgress(saved).done, 0);
  saved = updateItem(saved, { id: 'llc', done: true });
  saved = updateItem(saved, { id: 'llc', note: 'Example Holdings LLC, WY' });
  const p = withProgress(saved);
  assert.strictEqual(p.done, 1);
  assert.strictEqual(p.total, 15);
  const llc = p.groups[0].items.find((i) => i.id === 'llc');
  assert.deepStrictEqual([llc.done, llc.note], [true, 'Example Holdings LLC, WY']);
  assert.throws(() => updateItem(saved, { id: 'nope', done: true }));
});
