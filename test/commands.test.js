const test = require('node:test');
const assert = require('node:assert');
Object.assign(globalThis, require('../n8n/code/messages.js'), require('../n8n/code/recurring.js'));
const { runCommand, countToday } = require('../n8n/code/commands.js');
const { ACCOUNTS } = require('./sample.test.js');

const NOW = '2026-11-13T05:00:00Z';
const INBOX = { update_id: 90, msg_date: '2026-11-13T12:00:00+07:00', kind: 'command' };
const tx = (id, batch, status = 'ok', o = {}) => ({ id, batch_id: batch, status, txn_date: '2026-11-13', source: 'text', ...o });
const TXNS = [tx('T0001', 'B1'), tx('T0002', 'B2'), tx('T0003', 'B2'), tx('T0004', 'B3', 'void')];
const run = (text, o = {}) => runCommand({ text, transactions: TXNS, accounts: ACCOUNTS, nextIdNum: 200, inbox: INBOX, now: NOW, ...o });

test('/undo voids every row of the latest non-void batch', () => {
  const r = run('/undo');
  assert.deepEqual(r.voidIds, ['T0002', 'T0003']);
  assert.deepEqual(r.appendRows, []);
  assert.equal(r.reply, '↩️ Voided 2 entries (#T0002, #T0003).');
});

test('/undo: latest means highest id, not sheet order; void rows are skipped', () => {
  const r = run('/undo', { transactions: [tx('T0010', 'B9'), tx('T0002', 'B2'), tx('T0011', 'B9', 'void')] });
  assert.deepEqual(r.voidIds, ['T0010']);
  assert.equal(run('/undo', { transactions: [tx('T10000', 'B5'), tx('T9999', 'B4')] }).voidIds[0], 'T10000');
});

test('/undo with nothing to void', () => {
  const r = run('/undo', { transactions: [tx('T0001', 'B1', 'void')] });
  assert.deepEqual(r, { reply: 'Nothing to void.', appendRows: [], voidIds: [] });
  assert.equal(run('/undo', { transactions: [] }).reply, 'Nothing to void.');
});

test('/balance lists every account and the liquid total only', () => {
  const r = run('/balance');
  assert.equal(
    r.reply,
    ['Balance', 'Cash · Rp100.000', 'BCA · Rp1.250.000', 'BNI · Rp500.000', 'Koperasi · Rp2.000.000', 'Investment · Rp9.000.000', 'Liquid total · Rp3.850.000'].join('\n'),
  );
  assert.deepEqual([r.appendRows, r.voidIds], [[], []]);
});

test('/cash: lower real cash writes an expense adjustment', () => {
  const r = run('/cash 80000');
  assert.equal(r.appendRows.length, 1);
  const row = r.appendRows[0];
  assert.deepEqual(
    [row.id, row.type, row.amount, row.account, row.category_id, row.source, row.status, row.txn_date, row.txn_time, row.batch_id, row.inbox_update_id, row.created_at, row.nature],
    ['T0200', 'expense', 20000, 'Cash', 'unrecorded-cash', 'adjustment', 'ok', '2026-11-13', '12:00', 'B90', 90, '2026-11-13T12:00:00+07:00', ''],
  );
  assert.equal(r.reply, '✅ Cash set to Rp80.000. Logged Rp20.000 as unrecorded cash (#T0200) · /undo');
  assert.deepEqual(r.voidIds, []);
});

test('/cash: higher real cash writes an income adjustment', () => {
  const row = run('/cash 150000').appendRows[0];
  assert.deepEqual([row.type, row.amount], ['income', 50000]);
});

test('/cash: same amount writes no row', () => {
  const r = run('/cash 100000');
  assert.deepEqual(r, { reply: 'Cash matches at Rp100.000. Nothing to log.', appendRows: [], voidIds: [] });
});

test('/cash: accepts 150000, 150.000, 150rb and friends', () => {
  const amount = (arg) => run('/cash ' + arg).appendRows[0].amount + 100000;
  assert.equal(amount('150000'), 150000);
  assert.equal(amount('150.000'), 150000);
  assert.equal(amount('150rb'), 150000);
  assert.equal(amount('150k'), 150000);
  assert.equal(amount('Rp150.000'), 150000);
  assert.equal(amount('1,5jt'), 1500000);
  assert.equal(amount('200.000,00'), 200000);
  assert.equal(amount('150,000.00'), 150000);
  assert.equal(amount('150000.00'), 150000);
  assert.equal(amount('IDR 150,000.00'), 150000);
  assert.equal(amount('1.500rb'), 1500000);
  assert.equal(amount('2jt'), 2000000);
  assert.equal(run('/cash 0').appendRows[0].amount, 100000);
});

test('/cash: no or bad amount shows usage, writes nothing', () => {
  for (const t of ['/cash', '/cash abc', '/cash -5']) {
    const r = run(t);
    assert.equal(r.reply, '❓ How much cash do you have? Send e.g. "/cash 150000".');
    assert.deepEqual(r.appendRows, []);
  }
});

test('/cash uses the Cash balance as a string too', () => {
  const accs = ACCOUNTS.map((a) => (a.account === 'Cash' ? { ...a, balance: '100000' } : a));
  assert.equal(run('/cash 100000', { accounts: accs }).appendRows.length, 0);
});

test('/help lists commands with examples', () => {
  const r = run('/help');
  assert.equal(r.reply, MSG.help());
  assert.ok(r.reply.includes('/cash 150000'));
});

test('matching is case-insensitive and ignores @botname', () => {
  assert.equal(run('/UNDO').voidIds.length, 2);
  assert.equal(run('/undo@my_expense_bot').voidIds.length, 2);
  assert.match(run('/Balance@my_expense_bot').reply, /^Balance/);
  assert.equal(run('/cash@my_expense_bot 80000').appendRows[0].amount, 20000);
  assert.equal(run('  /help  ').reply, MSG.help());
});

test('unknown commands, including v1b ones', () => {
  for (const t of ['/split', '/foo', '/']) {
    const r = run(t);
    assert.equal(r.reply, MSG.unknownCommand());
    assert.deepEqual([r.appendRows, r.voidIds], [[], []]);
  }
});

test('countToday counts today, non-void, non-opening/adjustment entries', () => {
  const t = [
    tx('T1', 'B1'),
    tx('T2', 'B2', 'needs_review'),
    tx('T3', 'B3', 'void'),
    tx('T4', 'B4', 'ok', { txn_date: '2026-11-12' }),
    tx('T5', 'B5', 'ok', { source: 'opening' }),
    tx('T6', 'B6', 'ok', { source: 'adjustment' }),
    tx('T7', 'B7', 'ok', { txn_date: '2026-11-13T00:00:00' }),
  ];
  assert.equal(countToday(t, '2026-11-13'), 3);
  assert.equal(countToday([], '2026-11-13'), 0);
});

const REVIEW = [
  tx('T0016', 'B7', 'needs_review', { type: 'transfer', amount: 66000, account: 'BCA', to_account: 'Cash', merchant: 'NADIYA' }),
  tx('T0017', 'B7', 'ok', { type: 'expense', amount: 13900, account: 'BCA', category_id: 'others', merchant: 'ALFAMART' }),
  tx('T0025', 'B7', 'needs_review', { type: 'expense', amount: 100000, account: 'BCA', category_id: 'others', note: 'utang' }),
  tx('T0003', 'B2', 'void'),
];
const rv = (text) => run(text, { transactions: REVIEW });

test('/review lists what needs review, oldest first, and says how to answer', () => {
  const lines = rv('/review').reply.split('\n');
  assert.equal(lines[0], '⚠️ 2 entries need review');
  assert.equal(lines[1], '⚠️ #T0016 · 13 Nov 2026 · Rp66.000 · BCA → Cash · "NADIYA"');
  assert.equal(lines[2], '⚠️ #T0025 · 13 Nov 2026 · Rp100.000 · others · BCA · "utang"');
  assert.match(lines[3], /\/ok .*\/undo 25/);
  assert.equal(run('/review').reply, 'Nothing needs review.');
});

test('/ok confirms every entry that needs review, or only the ids given', () => {
  assert.deepEqual(rv('/ok').okIds, ['T0016', 'T0025']);
  assert.equal(rv('/ok').reply, '✅ Confirmed 2 entries (#T0016, #T0025).');
  assert.deepEqual(rv('/ok 25').okIds, ['T0025']);
  assert.deepEqual(rv('/ok #T0025, t16').okIds, ['T0025', 'T0016']);
  assert.deepEqual([rv('/ok').voidIds, rv('/ok').appendRows], [[], []]);
  assert.equal(run('/ok').reply, 'Nothing needs review.');
});

test('/ok with an id that is unknown or not waiting changes nothing', () => {
  const r = rv('/ok 25 17 99');
  assert.deepEqual(r.okIds, []);
  assert.match(r.reply, /^❓ Nothing changed: 99, #T0017 not found or not waiting for review/);
});

test('/undo with ids voids exactly those entries, all or nothing', () => {
  assert.deepEqual(rv('/undo 25').voidIds, ['T0025']);
  assert.equal(rv('/undo 25').reply, '↩️ Voided 1 entry (#T0025).');
  assert.deepEqual(rv('/undo T0016 17').voidIds, ['T0016', 'T0017']);
  const bad = rv('/undo 25 3 abc');
  assert.deepEqual(bad.voidIds, []);
  assert.match(bad.reply, /^❓ Nothing changed: abc, #T0003 not found or already void/);
  assert.deepEqual(rv('/undo').voidIds, ['T0016', 'T0017', 'T0025']); // no id: still the latest batch
});

test('/last shows the newest live entries, 5 unless a number is given', () => {
  const lines = rv('/last').reply.split('\n');
  assert.deepEqual(lines.map((l) => (/#T\d+/.exec(l) || [''])[0]), ['', '#T0025', '#T0017', '#T0016']);
  assert.equal(lines[2], '✅ #T0017 · 13 Nov 2026 · Rp13.900 · others · BCA · "ALFAMART"');
  assert.equal(rv('/last 1').reply.split('\n').length, 2);
  assert.equal(run('/last', { transactions: [] }).reply, 'No entries yet.');
});

// /summary: NOW is 13 Nov 2026 (a Friday) in Jakarta
const { CATEGORIES } = require('./sample.test.js');
const OPENED = ACCOUNTS.map((a) => ({ ...a, opening_date: '2026-07-20' }));
const row = (id, txn_date, type, amount, category_id, o = {}) => ({ id, status: 'ok', source: 'text', txn_date, txn_time: '12:30', type, amount, category_id, account: 'BCA', nature: '', irregular: false, ...o });
const LEDGER = [
  row('T0001', '2026-11-01', 'income', 9500000, 'income-salary'),
  row('T0002', '2026-11-02', 'income', '1500000', 'income-freelance'),
  row('T0003', '2026-11-03', 'expense', 50000, 'food', { nature: 'need' }),
  row('T0004', '2026-11-04', 'expense', 30000, 'food', { nature: 'want', txn_time: '19:10' }),
  row('T0005', '2026-11-07', 'expense', 120000, 'game', { nature: 'want', txn_time: '23:40' }), // Saturday
  row('T0006', '2026-11-05', 'expense', 100000, 'transport-ojol-bensin', { nature: 'need', status: 'needs_review' }),
  row('T0007', '2026-11-06', 'expense', 600000, 'transport-ojol-bensin', { nature: 'need', irregular: 'TRUE', note: 'pajak motor' }),
  row('T0008', '2026-11-06', 'expense', 20000, 'e-wallet-top-up'),
  row('T0009', '2026-11-08', 'transfer', 700000, '', { to_account: 'Cash' }),
  row('T0010', '2026-11-09', 'expense', 999999, 'food', { status: 'void' }),
  row('T0011', '2026-11-01', 'income', 888888, 'income-salary', { source: 'opening' }),
  row('T0012', '2026-10-10', 'expense', 2000000, 'food', { nature: 'need' }),
  row('T0013', '2026-09-10', 'expense', 1000000, 'food', { nature: 'need' }),
  row('T0014', '2026-08-10', 'expense', 850000, 'food', { nature: 'need' }),
  row('T0015', '2026-10-11', 'expense', 600000, 'game', { nature: 'want', irregular: true }),
  row('T0016', '2025-11-30', 'expense', 1200000, 'game', { irregular: true }), // outside the 12 months
];
const summary = (text, o = {}) => runCommand({ text, transactions: LEDGER, accounts: OPENED, categories: CATEGORIES, nextIdNum: 200, inbox: INBOX, now: NOW, ...o });

test('/summary: this month in numbers, totals from code', () => {
  const r = summary('/summary');
  assert.deepEqual([r.appendRows, r.voidIds], [[], []]);
  assert.equal(
    r.reply,
    [
      'Summary · Nov 2026 (to 13 Nov 2026)',
      'Income · Rp11.000.000',
      'Expense · Rp920.000',
      'Net · Rp10.080.000',
      '',
      'Expense by group',
      'Transport · Rp700.000 · 76%',
      '   Transport / ojol / bensin · Rp700.000',
      'Lifestyle · Rp120.000 · 13%',
      '   Game · Rp120.000',
      'Living · Rp80.000 · 9%',
      '   Food · Rp80.000',
      'Other · Rp20.000 · 2%',
      '   E-wallet top-up · Rp20.000',
      '',
      'Need vs want',
      'Need · Rp750.000 · 82%',
      'Want · Rp150.000 · 16%',
      'Not set · Rp20.000 · 2%',
      'Top want · Game Rp120.000 · Food Rp30.000',
      'Want by day · weekday Rp30.000 · weekend Rp120.000',
      'Want by time · evening Rp30.000 · night Rp120.000',
      '',
      'Irregular',
      '6 Nov 2026 · Rp600.000 · Transport / ojol / bensin · "pajak motor"',
      '12-month average · Rp100.000 a month',
      '',
      'Freelance income · Rp1.500.000',
      '⚠️ 1 entry needs review · /review',
      'Liquid total · Rp3.850.000',
      'Runway · 3.0 months ("need" spending Rp1.283.333 a month over the last 3 full months)',
    ].join('\n'),
  );
});

test('/summary YYYY-MM: another month has no "to" date; a month without entries says so', () => {
  const oct = summary('/summary 2026-10').reply;
  assert.match(oct, /^Summary · Oct 2026\nIncome · Rp0\nExpense · Rp2\.600\.000\nNet · -Rp2\.600\.000\n/);
  assert.match(oct, /\n11 Oct 2026 · Rp600\.000 · Game\n12-month average · Rp150\.000 a month\n/);
  assert.equal(summary('/summary 2026-12').reply, 'No entries in Dec 2026.');
  assert.equal(summary('/summary', { transactions: [] }).reply, 'No entries in Nov 2026.');
  for (const bad of ['/summary oktober', '/summary 2026-13', '/summary 2026-1']) assert.equal(summary(bad).reply, MSG.summaryUsage());
});

test('/summary runway counts only full months after the opening balance', () => {
  const opened = (d) => ACCOUNTS.map((a) => ({ ...a, opening_date: d }));
  assert.match(summary('/summary', { accounts: opened('2026-10-28') }).reply, /\nRunway · not enough history yet \(needs one full month of entries\)$/);
  // only October is full: 3.850.000 / 2.000.000
  assert.match(summary('/summary', { accounts: opened('2026-09-15') }).reply, /\nRunway · 1\.9 months \("need" spending Rp2\.000\.000 a month over the last 1 full month\)$/);
  // no opening date: the first entry (30 Nov 2025) decides
  assert.match(summary('/summary', { accounts: ACCOUNTS }).reply, /over the last 3 full months\)$/);
  const noNeed = LEDGER.filter((t) => t.nature !== 'need' || t.txn_date >= '2026-11');
  assert.match(summary('/summary', { transactions: noNeed }).reply, /\nRunway · no "need" spending in the last 3 full months$/);
});
