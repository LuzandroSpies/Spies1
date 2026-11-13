'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dealflip-auth-'));
process.env.DEALFLIP_STORE = path.join(tmp, 'store.json');
process.env.DEALFLIP_PASSWORD = 'correct horse';
process.env.HOME = tmp;
const app = require('../server');

let base, server;
test.before(() => new Promise((r) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }));
test.after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const auth = (p) => ({ Authorization: `Basic ${Buffer.from(`me:${p}`).toString('base64')}` });

test('password protects the app and its data', async () => {
  assert.strictEqual((await fetch(`${base}/`)).status, 401);
  assert.strictEqual((await fetch(`${base}/api/deals`)).status, 401);
  assert.strictEqual((await fetch(`${base}/api/deals`, { headers: auth('wrong') })).status, 401);
  assert.strictEqual((await fetch(`${base}/api/deals`, { headers: auth('correct horse') })).status, 200);
});

test('the investor sign-up stays public', async () => {
  assert.strictEqual((await fetch(`${base}/join`)).status, 200);
  const r = await fetch(`${base}/api/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'X', contact: 'x@example.com', states: ['OH'] }) });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await fetch(`${base}/api/buyers`)).status, 401);
});
