const test = require('node:test');
const assert = require('node:assert');
const fixtures = require('../fixtures/text.json');
const seed = require('../data/seed.json');
const { compare } = require('../fixtures/run.js');

const rowsOf = () => fixtures.flatMap((f) => f.expect.rows || []);

test('20 fixtures with unique names and valid dates', () => {
  assert.strictEqual(fixtures.length, 20);
  assert.strictEqual(new Set(fixtures.map((f) => f.name)).size, 20);
  for (const f of fixtures) {
    assert.ok(!isNaN(Date.parse(f.msg_date)), f.name);
    assert.ok(f.expect.ask || f.expect.rows.length, f.name);
  }
});

test('expected categories and accounts exist in seed and are active', () => {
  const cats = new Set(seed.categories.filter((c) => c.active).map((c) => c.id));
  const accs = new Set(seed.accounts.map((a) => a.account));
  for (const r of rowsOf()) {
    if (r.category_id) assert.ok(cats.has(r.category_id), r.category_id);
    for (const a of [r.account, r.to_account]) if (a) assert.ok(accs.has(a), a);
  }
});

test('transfers expect a to_account', () => {
  for (const r of rowsOf().filter((r) => r.type === 'transfer')) assert.ok(r.to_account);
});

test('compare: match, mismatch, any-of, ask', () => {
  const res = { ok: true, rows: [{ type: 'expense', amount: 25000, nature: 'need' }] };
  assert.deepStrictEqual(compare({ rows: [{ amount: 25000, nature: ['need', 'want'] }] }, res), []);
  assert.strictEqual(compare({ rows: [{ amount: 30000 }] }, res).length, 1);
  assert.strictEqual(compare({ rows: [{ nature: ['want', 'other'] }] }, res).length, 1);
  assert.strictEqual(compare({ ask: true }, res).length, 1);
  assert.deepStrictEqual(compare({ ask: true }, { ok: false, reply: '?' }), []);
});
