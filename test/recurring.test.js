const test = require('node:test');
const assert = require('node:assert');
Object.assign(globalThis, require('../n8n/code/messages.js'), require('../n8n/code/recurring.js'));
const { runCommand } = require('../n8n/code/commands.js');
const { runRecurring, recurringPending, recDue } = require('../n8n/code/recurring.js');
const { CATEGORIES, ACCOUNTS } = require('./sample.test.js');

const NOW = '2026-12-05T00:30:00Z'; // 5 Dec 2026 07:30 in Jakarta
const INBOX = { update_id: 'R1', kind: 'command', text: '/recurring run' };
const rule = (o) => ({
  id: 'R1', name: 'KPR & IPL', type: 'expense', amount: 5000000, account: 'BCA', to_account: '', category_id: 'food', nature: 'need',
  cycle: 'monthly', interval: 1, day: 5, start_date: '2026-12-05', end_date: '', mode: 'auto', last_run: '', active: 'TRUE', ...o,
});
const run = (rules, o = {}) => runRecurring({ rules: [].concat(rules), transactions: [], accounts: ACCOUNTS, categories: CATEGORIES, nextIdNum: 310, inbox: INBOX, now: NOW, ...o });
const dates = (o, after, until) => recDue(rule(o), after, until).dates;

test('monthly: from start_date, one per month, 29-31 fall back to the last day', () => {
  assert.deepEqual(dates({}, '', '2027-02-10'), ['2026-12-05', '2027-01-05', '2027-02-05']);
  assert.deepEqual(dates({ day: 31, start_date: '2027-01-01' }, '', '2027-04-30'), ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']);
  assert.deepEqual(dates({ day: 29, start_date: '2028-02-01' }, '', '2028-02-29'), ['2028-02-29']);
  // the day already passed in the start month: the first date is next month
  assert.deepEqual(dates({ day: 5, start_date: '2026-12-06' }, '', '2027-01-31'), ['2027-01-05']);
  assert.deepEqual(dates({ interval: 3 }, '', '2027-07-01'), ['2026-12-05', '2027-03-05', '2027-06-05']);
});

test('after last_run, up to today and end_date', () => {
  assert.deepEqual(dates({}, '2026-12-05', '2027-02-05'), ['2027-01-05', '2027-02-05']);
  assert.deepEqual(dates({ end_date: '2027-01-05' }, '', '2027-06-01'), ['2026-12-05', '2027-01-05']);
  assert.deepEqual(dates({}, '', '2026-12-04'), []);
});

test('weekly and yearly', () => {
  // 2026-12-05 is a Saturday
  assert.deepEqual(dates({ cycle: 'weekly', day: 'mon', start_date: '2026-12-05' }, '', '2026-12-21'), ['2026-12-07', '2026-12-14', '2026-12-21']);
  assert.deepEqual(dates({ cycle: 'weekly', day: 'Saturday', interval: 2 }, '', '2026-12-31'), ['2026-12-05', '2026-12-19']);
  assert.deepEqual(dates({ cycle: 'weekly', day: 7 }, '', '2026-12-13'), ['2026-12-06', '2026-12-13']);
  assert.deepEqual(dates({ cycle: 'yearly', day: '03-15', start_date: '2026-01-01' }, '', '2028-12-31'), ['2026-03-15', '2027-03-15', '2028-03-15']);
  assert.deepEqual(dates({ cycle: 'yearly', day: '02-29', start_date: '2027-01-01' }, '', '2028-12-31'), ['2027-02-28', '2028-02-29']);
});

test('a rule that cannot be read says why', () => {
  for (const [o, why] of [
    [{ start_date: '5 Dec' }, /start_date/], [{ end_date: 'never' }, /end_date/], [{ cycle: 'daily' }, /cycle/],
    [{ day: 0 }, /1 to 31/], [{ cycle: 'weekly', day: 5 + 'th' }, /weekday/], [{ cycle: 'yearly', day: '15' }, /MM-DD/],
  ]) assert.match(recDue(rule(o), '', '2027-01-01').error, why);
});

test('auto: writes the entry dated on the due date and moves last_run', () => {
  const r = run(rule());
  assert.equal(r.appendRows.length, 1);
  const row = r.appendRows[0];
  assert.deepEqual(
    [row.id, row.txn_date, row.type, row.amount, row.account, row.category_id, row.nature, row.source, row.recurring_id, row.batch_id, row.status, row.note],
    ['T0310', '2026-12-05', 'expense', 5000000, 'BCA', 'food', 'need', 'recurring', 'R1', 'BR1', 'ok', 'KPR & IPL'],
  );
  assert.equal(row.created_at, '2026-12-05T07:30:00+07:00');
  assert.deepEqual(r.ruleUpdates, [{ id: 'R1', last_run: '2026-12-05' }]);
  assert.equal(r.reply, '📌 KPR & IPL Rp5.000.000 · BCA · logged for 5 Dec 2026 (#T0310) · /undo 310');
  assert.deepEqual(r.voidIds, []);
});

test('catch-up: every date missed while n8n was off, ids in order', () => {
  const r = run(rule({ start_date: '2026-09-05', last_run: '2026-09-05' }));
  assert.deepEqual(r.appendRows.map((x) => [x.id, x.txn_date]), [['T0310', '2026-10-05'], ['T0311', '2026-11-05'], ['T0312', '2026-12-05']]);
  assert.deepEqual(r.ruleUpdates, [{ id: 'R1', last_run: '2026-12-05' }]);
});

test('a date that is already in the Sheet is not written twice, but last_run still moves', () => {
  const r = run(rule(), { transactions: [{ id: 'T0300', recurring_id: 'R1', txn_date: '2026-12-05', status: 'void' }] });
  assert.deepEqual(r.appendRows, []);
  assert.deepEqual(r.ruleUpdates, [{ id: 'R1', last_run: '2026-12-05' }]);
  assert.equal(r.reply, 'No recurring items are due.');
});

test('nothing due, inactive rules and empty rows are silent', () => {
  const r = run([rule({ last_run: '2026-12-05' }), rule({ id: 'R2', active: 'FALSE' }), {}, rule({ id: 'R3', start_date: '2027-01-05' })]);
  assert.deepEqual([r.appendRows, r.ruleUpdates, r.reply], [[], [], 'No recurring items are due.']);
  assert.equal(recurringPending([rule({ last_run: '2026-12-05' }), {}], NOW), false);
  assert.equal(recurringPending([rule()], NOW), true);
  assert.equal(recurringPending([rule({ start_date: 'x' })], NOW), true); // a broken rule gets its message
});

test('reminder: asks, writes nothing, and moves last_run', () => {
  const r = run(rule({ id: 'R5', name: 'Internet bill', amount: 350000, mode: 'reminder', category_id: '' }));
  assert.deepEqual(r.appendRows, []);
  assert.equal(r.reply, '🔔 Internet bill due today (usually Rp350.000, BCA). Log it when paid.');
  assert.deepEqual(r.ruleUpdates, [{ id: 'R5', last_run: '2026-12-05' }]);
  const late = run(rule({ id: 'R5', name: 'Listrik', amount: '', mode: 'reminder', start_date: '2026-12-01', day: 1 }));
  assert.equal(late.reply, '🔔 Listrik was due 1 Dec 2026 (amount varies, BCA). Log it when paid.');
});

test('transfer rule and income rule', () => {
  const t = run(rule({ type: 'transfer', to_account: 'investment', category_id: '', amount: 1000000, name: 'Invest' }));
  assert.deepEqual([t.appendRows[0].type, t.appendRows[0].account, t.appendRows[0].to_account, t.appendRows[0].category_id, t.appendRows[0].nature], ['transfer', 'BCA', 'Investment', '', '']);
  assert.match(t.reply, /BCA → Investment/);
  const i = run(rule({ type: 'income', category_id: 'income-salary', nature: '' }));
  assert.deepEqual([i.appendRows[0].type, i.appendRows[0].nature], ['income', '']);
});

test('a broken rule is skipped with a reason and does not stop the others', () => {
  const r = run([
    rule({ id: 'A', name: 'No amount', amount: '' }),
    rule({ id: 'B', name: 'Bad account', account: 'Mandiri' }),
    rule({ id: 'C', name: 'Bad category', category_id: 'income-salary' }),
    rule({ id: 'D', name: 'Bad mode', mode: 'yes' }),
    rule({ id: 'E', name: 'Old', start_date: '2020-01-05' }),
    rule({ id: 'F', name: 'Same', type: 'transfer', to_account: 'BCA' }),
    rule({ id: 'G', name: 'Fine' }),
  ]);
  const lines = r.reply.split('\n');
  assert.equal(lines.length, 7);
  assert.match(lines[0], /^❓ Recurring rule "No amount" skipped: an auto rule needs an amount\. Fix it in the Recurring tab\.$/);
  assert.match(lines[1], /unknown account "Mandiri"/);
  assert.match(lines[2], /not an expense category/);
  assert.match(lines[3], /mode must be auto or reminder/);
  assert.match(lines[4], /more than 12 dates are due/);
  assert.match(lines[5], /two different accounts/);
  assert.deepEqual(r.appendRows.map((x) => x.recurring_id), ['G']);
  assert.deepEqual(r.ruleUpdates, [{ id: 'G', last_run: '2026-12-05' }]);
});

test('/recurring lists active rules with the next date; "/recurring run" runs them', () => {
  const cmd = (text, recurring) => runCommand({ text, transactions: [], accounts: ACCOUNTS, categories: CATEGORIES, recurring, nextIdNum: 1, inbox: INBOX, now: NOW });
  const rules = [
    rule({ last_run: '2026-12-05' }),
    rule({ id: 'R2', name: 'Internet', amount: '', mode: 'reminder', day: 20, start_date: '2026-11-01', last_run: '2026-11-20' }),
    rule({ id: 'R3', name: 'Due', start_date: '2026-12-01', day: 1 }),
    rule({ id: 'R4', name: 'Done', end_date: '2026-12-05', last_run: '2026-12-05' }),
    rule({ id: 'R5', name: 'Yearly', cycle: 'yearly', day: '03-15', interval: 2, mode: 'reminder' }),
    rule({ id: 'R6', name: 'Off', active: false }),
    rule({ id: 'R7', name: 'Broken', cycle: 'x' }),
  ];
  assert.equal(cmd('/recurring', rules).reply, [
    'Recurring rules',
    'KPR & IPL · Rp5.000.000 · BCA · monthly · auto · next 5 Jan 2027',
    'Internet · amount varies · BCA · monthly · reminder · next 20 Dec 2026',
    'Due · Rp5.000.000 · BCA · monthly · auto · due now (1 Dec 2026)',
    'Done · Rp5.000.000 · BCA · monthly · auto · ended',
    'Yearly · Rp5.000.000 · BCA · every 2 × yearly · reminder · next 15 Mar 2027',
    'Broken · Rp5.000.000 · BCA · x · auto · ❓ cycle must be weekly, monthly or yearly',
  ].join('\n'));
  assert.match(cmd('/recurring', []).reply, /^No active recurring rules/);
  assert.match(cmd('/recurring', undefined).reply, /^No active recurring rules/);
  assert.deepEqual(cmd('/recurring', rules).appendRows, []);
  const ran = cmd('/recurring run', [rule()]);
  assert.equal(ran.appendRows.length, 1);
  assert.equal(ran.ruleUpdates.length, 1);
  assert.ok(MSG.help().includes('/recurring'));
});
