const test = require('node:test');
const assert = require('node:assert');
const { MSG, fmtRp, fmtDate } = require('../n8n/code/messages.js');
const { CATEGORIES } = require('./sample.test.js');

test('fmtRp uses dot thousands and handles strings and negatives', () => {
  assert.equal(fmtRp(25000), 'Rp25.000');
  assert.equal(fmtRp('4250000'), 'Rp4.250.000');
  assert.equal(fmtRp(0), 'Rp0');
  assert.equal(fmtRp(-1500), '-Rp1.500');
});

test('fmtDate', () => {
  assert.equal(fmtDate('2026-11-01'), '1 Nov 2026');
  assert.equal(fmtDate('2026-12-25T10:00:00+07:00'), '25 Dec 2026');
});

const row = (o) => ({ id: 'T0123', type: 'expense', amount: 25000, account: 'BCA', category_id: 'food', note: 'makan padang', nature: 'need', status: 'ok', ...o });

test('spec sample 1: saved entry, word for word', () => {
  assert.equal(MSG.saved([row()], CATEGORIES), '✅ Rp25.000 · Food · BCA · "makan padang" · need  (#T0123) · /undo');
});

test('spec sample 2: ask for amount, word for word', () => {
  assert.equal(MSG.askAmount('kopi kemarin'), '❓ How much was it? Reply with the amount, e.g. "kopi kemarin 18rb".');
});

test('spec sample 3: error, word for word', () => {
  assert.equal(
    MSG.error('makan padang 25rb'),
    '🔴 Couldn\'t process "makan padang 25rb" (the AI service did not respond). Please send it again.',
  );
});

test('saved: needs review, transfer, one line per row, /undo only at the end', () => {
  assert.equal(MSG.saved([row({ status: 'needs_review' })], CATEGORIES), '⚠️ Rp25.000 · Food · BCA · "makan padang" · need  (#T0123) · needs review · /undo');
  const out = MSG.saved(
    [row({ type: 'transfer', amount: 500000, to_account: 'Cash', note: '', nature: '', category_id: '' }), row({ id: 'T0124', amount: 6500, category_id: 'bank-fee', note: 'Transfer fee' })],
    CATEGORIES,
  ).split('\n');
  assert.equal(out.length, 2);
  assert.equal(out[0], '✅ Rp500.000 · BCA → Cash  (#T0123)');
  assert.equal(out[1], '✅ Rp6.500 · Bank fee · BCA · "Transfer fee" · need  (#T0124) · /undo');
});

test('other replies', () => {
  assert.equal(MSG.futureDate(), '❓ That date is in the future. For upcoming payments, add a rule in the Recurring tab.');
  assert.equal(MSG.pending(3), '📥 Processing 3 pending messages');
  assert.equal(MSG.pending(1), '📥 Processing 1 pending message');
  assert.equal(MSG.voided(['T0001', 'T0002']), '↩️ Voided 2 entries (#T0001, #T0002).');
  assert.equal(MSG.voided(['T0001']), '↩️ Voided 1 entry (#T0001).');
  assert.equal(MSG.nothingToVoid(), 'Nothing to void.');
  assert.equal(MSG.nudge(2), '2 entries today. Anything missing?');
  assert.equal(MSG.nudge(1), '1 entry today. Anything missing?');
  assert.equal(MSG.cashMatches(150000), 'Cash matches at Rp150.000. Nothing to log.');
  assert.match(MSG.cashAdjusted(150000, -20000, 'T0301'), /^✅ Cash set to Rp150\.000\. Logged Rp20\.000 as unrecorded cash \(#T0301\)/);
  assert.match(MSG.askMissing(['merchant'], 'which shop?'), /^❓ .*merchant.*which shop\?/);
  assert.equal(MSG.balance([{ account: 'Cash', balance: 1000 }], 1000), 'Balance\nCash · Rp1.000\nLiquid total · Rp1.000');
});

test('help lists each command with an example; no exclamation marks anywhere', () => {
  const help = MSG.help();
  for (const c of ['/undo', '/summary', '/balance', '/cash', '/help']) assert.ok(help.includes(c));
  assert.ok(help.includes('/cash 150000'));
  for (const s of [help, MSG.unknownCommand(), MSG.cashUsage(), MSG.badCategory('x'), MSG.sameAccount()]) assert.ok(!s.includes('!'));
});
