const test = require('node:test');
const assert = require('node:assert');
const { buildLlmRequest } = require('../n8n/code/prompt.js');
const { CATEGORIES, ACCOUNTS } = require('./sample.test.js');

const build = (o = {}) =>
  buildLlmRequest({ kind: 'text', text: 'makan padang 25rb', msgDate: '2026-11-01T08:10:00+07:00', categories: CATEGORIES, accounts: ACCOUNTS, model: 'test-model', ...o });
const txnProps = (req) => req.response_format.json_schema.schema.properties.transactions.items.properties;

test('request body: model, strict json_schema, system then user', () => {
  const req = build();
  assert.equal(req.model, 'test-model');
  assert.deepEqual(req.messages.map((m) => m.role), ['system', 'user']);
  assert.equal(req.messages[1].content, 'makan padang 25rb');
  assert.equal(req.response_format.type, 'json_schema');
  assert.equal(req.response_format.json_schema.strict, true);
  assert.ok(req.response_format.json_schema.name);
  assert.doesNotThrow(() => JSON.stringify(req));
});

test('strict mode: every object lists all properties as required, no additionalProperties', () => {
  const walk = (s) => {
    if (!s || typeof s !== 'object') return;
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort());
      Object.values(s.properties).forEach(walk);
    }
    if (s.items) walk(s.items);
    (s.anyOf || []).forEach(walk);
  };
  walk(build().response_format.json_schema.schema);
});

test('schema has every parse field plus txn_time', () => {
  const p = txnProps(build());
  for (const k of ['type', 'amount', 'account', 'to_account', 'category_id', 'nature', 'merchant', 'note', 'txn_date', 'txn_time', 'fee', 'irregular', 'items', 'receipt', 'confidence']) {
    assert.ok(k in p, k);
  }
  const top = build().response_format.json_schema.schema.properties;
  assert.deepEqual(Object.keys(top).sort(), ['missing', 'reply_hint', 'transactions']);
  assert.deepEqual(p.txn_time.type, ['string', 'null']);
  assert.deepEqual(p.type.enum, ['expense', 'income', 'transfer']);
});

test('category_id and account are enums built from the injected lists; only active categories', () => {
  const p = txnProps(build());
  assert.deepEqual(p.category_id.enum, ['food', 'transport-ojol-bensin', 'game', 'bank-fee', 'unrecorded-cash', 'e-wallet-top-up', 'income-salary', 'income-freelance', null]);
  assert.ok(!p.category_id.enum.includes('income-stock'));
  assert.deepEqual(p.account.enum, ['Cash', 'BCA', 'BNI', 'Koperasi', 'Investment']);
  assert.deepEqual(p.to_account.enum, ['Cash', 'BCA', 'BNI', 'Koperasi', 'Investment', null]);
});

test('system prompt carries rules, categories (with aliases), accounts and message time', () => {
  const sys = build().messages[0].content;
  assert.match(sys, /ceban/);
  assert.match(sys, /1,5jt/);
  assert.match(sys, /ATM/);
  assert.match(sys, /Investment/);
  assert.match(sys, /#irregular/);
  assert.match(sys, /#need/);
  assert.match(sys, /freelance/i);
  assert.match(sys, /transport-ojol-bensin \| Transport \| Transport \/ ojol \/ bensin \| expense \| default_nature: need \| aliases: gojek, grab, bensin/);
  assert.match(sys, /BCA \(default\)/);
  assert.match(sys, /2026-11-01 08:10 \(Sunday\)/);
  assert.ok(!sys.includes('income-stock'));
  assert.ok(!/Photo rules/.test(sys));
});

test('message time is converted to Asia/Jakarta', () => {
  assert.match(build({ msgDate: '2026-11-01T18:00:00Z' }).messages[0].content, /2026-11-02 01:00 \(Monday\)/);
});

test('photo: image_url part with the data URL, photo rules and receipt hints', () => {
  const req = build({ kind: 'photo', text: 'split ya', imageDataUrl: 'data:image/jpeg;base64,AAAA' });
  const content = req.messages[1].content;
  assert.deepEqual(content[0], { type: 'text', text: 'split ya' });
  assert.deepEqual(content[1], { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } });
  const sys = req.messages[0].content;
  assert.match(sys, /subtotal, tax, service, discount and total/);
  assert.match(sys, /TUNAI/);
  assert.equal(build({ kind: 'photo', text: '', imageDataUrl: 'x' }).messages[1].content[0].text, '(no caption)');
});

test('Sheets coercion: active as "TRUE"/"FALSE" strings', () => {
  const cats = CATEGORIES.map((c) => ({ ...c, active: c.active ? 'TRUE' : 'FALSE' }));
  const p = txnProps(build({ categories: cats }));
  assert.ok(p.category_id.enum.includes('food'));
  assert.ok(!p.category_id.enum.includes('income-stock'));
});
