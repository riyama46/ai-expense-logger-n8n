// Builds n8n/dist and checks the Code-node glue with stubbed n8n globals ($input, $).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { CATEGORIES, ACCOUNTS, jpeg } = require('./sample.test.js');

const root = path.join(__dirname, '..');
execFileSync(process.execPath, [path.join(root, 'n8n', 'build.js')]);
const dist = path.join(root, 'n8n', 'dist');
const raw = Object.fromEntries(
  fs.readdirSync(dist).filter((f) => f.endsWith('.json')).map((f) => [f, fs.readFileSync(path.join(dist, f), 'utf8')]),
);
const wf = (file) => JSON.parse(raw[file]);
const codeNodes = Object.keys(raw).flatMap((f) => wf(f).nodes.filter((n) => n.type === 'n8n-nodes-base.code').map((n) => [f, n]));

// Runs a Code node body. input: json objects seen by $input; nodes: {name: [json, ...]} seen by $('name').
function run(file, node, input, nodes = {}) {
  const wrap = (list) => list.map((json) => ({ json }));
  const $input = { all: () => wrap(input), first: () => ({ json: input[0] }) };
  const $ = (name) => {
    if (!nodes[name]) throw new Error(`unexpected $('${name}')`);
    return { all: () => wrap(nodes[name]), first: () => ({ json: nodes[name][0] }) };
  };
  const code = wf(file).nodes.find((n) => n.name === node).parameters.jsCode;
  return new Function('$input', '$', code)($input, $);
}

const NOW_TEXT = new Date(Date.now() - 3600000).toISOString(); // an hour ago, so never "in the future"
const config = { sheetId: 'YOUR_SHEET_ID', chatId: 'YOUR_CHAT_ID' };
const inbox = (o) => ({ row_number: 2, update_id: '501', msg_date: NOW_TEXT, chat_id: '1', kind: 'text', text: 'makan padang 25rb', file_id: '', status: 'processing', config, ...o });

test('dist has the five workflows, inactive, Asia/Jakarta', () => {
  assert.deepEqual(Object.keys(raw).sort(), ['commands.json', 'monthly-summary.json', 'nudge.json', 'parse-entry.json', 'process-inbox.json']);
  for (const f of Object.keys(raw)) {
    assert.equal(wf(f).active, false);
    assert.equal(wf(f).settings.timezone, 'Asia/Jakarta');
  }
});

test('every Code node compiles and has no include left', () => {
  assert.ok(codeNodes.length >= 9);
  for (const [f, n] of codeNodes) {
    assert.equal(typeof n.parameters.jsCode, 'string', `${f}/${n.name}`);
    assert.doesNotThrow(() => new Function(n.parameters.jsCode), `${f}/${n.name}`);
  }
  for (const f of Object.keys(raw)) assert.ok(!raw[f].includes('//@include'), f);
});

test('no secret or real id in dist', () => {
  for (const [f, text] of Object.entries(raw)) {
    assert.doesNotMatch(text, /sk-[A-Za-z0-9_-]{16,}/, `${f}: OpenAI key`);
    assert.doesNotMatch(text, /\d{8,10}:[A-Za-z0-9_-]{30,}/, `${f}: bot token`);
    assert.doesNotMatch(text, /[A-Za-z0-9_-]{40,}/, `${f}: Sheet id or other long token`);
    assert.doesNotMatch(text, /(?<![\w.])-?\d{9,}(?![\w.])/, `${f}: chat id`);
    for (const n of wf(f).nodes) for (const c of Object.values(n.credentials || {})) assert.equal(c.id, 'PLACEHOLDER');
  }
  const values = (f) => wf(f).nodes.find((n) => n.name === 'Config').parameters.assignments.assignments;
  for (const f of ['process-inbox.json', 'nudge.json', 'monthly-summary.json']) {
    for (const a of values(f).filter((a) => /sheet|chat/i.test(a.name))) assert.match(a.value, /^YOUR_/);
  }
});

test('Validate: LLM answer -> {inbox, ok, rows, reply}', () => {
  const parsed = {
    transactions: [{
      type: 'expense', amount: 25000, account: 'BCA', to_account: null, category_id: 'food', nature: 'need',
      merchant: null, note: 'makan padang', txn_date: null, txn_time: null, fee: 0, irregular: false,
      items: [], receipt: null, confidence: 0.92,
    }],
    missing: [],
    reply_hint: null,
  };
  const [out] = run('parse-entry.json', 'Validate', [{ choices: [{ message: { content: JSON.stringify(parsed) } }] }], {
    Start: [inbox()],
    Categories: CATEGORIES,
    Accounts: ACCOUNTS,
    Transactions: [{ id: 'T0009' }, { id: 'T0002' }],
  });
  assert.equal(out.json.ok, true);
  assert.equal(out.json.inbox.update_id, '501');
  assert.equal(out.json.rows.length, 1);
  assert.equal(out.json.rows[0].id, 'T0010');
  assert.equal(out.json.rows[0].batch_id, 'B501');
  assert.match(out.json.reply, /^✅ Rp25\.000 · Food · BCA/);
});

test('Validate: empty Transactions tab starts at T0001', () => {
  const parsed = { transactions: [], missing: ['amount'], reply_hint: null };
  const [out] = run('parse-entry.json', 'Validate', [{ choices: [{ message: { content: JSON.stringify(parsed) } }] }], {
    Start: [inbox({ text: 'kopi kemarin' })], Categories: CATEGORIES, Accounts: ACCOUNTS, Transactions: [{}],
  });
  assert.equal(out.json.ok, false);
  assert.match(out.json.reply, /^❓ How much/);
});

test('Build request: reads llm_model from State and refuses SET_ME', () => {
  const nodes = (model) => ({ Start: [inbox()], State: [{ key: 'llm_model', value: model }], Categories: CATEGORIES, Accounts: ACCOUNTS });
  const [out] = run('parse-entry.json', 'Build request', [{}], nodes('test-model'));
  assert.equal(out.json.body.model, 'test-model');
  assert.equal(out.json.body.messages[1].content, 'makan padang 25rb');
  assert.throws(() => run('parse-entry.json', 'Build request', [{}], nodes('SET_ME')), /llm_model/);
});

test('Build request: a scrolling screenshot is refused before the LLM, a normal one goes through', () => {
  const nodes = { Start: [inbox({ kind: 'photo', text: '', file_id: 'F1' })], State: [{ key: 'llm_model', value: 'test-model' }], Categories: CATEGORIES, Accounts: ACCOUNTS };
  const [long] = run('parse-entry.json', 'Build request', [{ image: jpeg(190, 1280) }], nodes);
  assert.equal(long.json.body, undefined);
  assert.equal(long.json.ok, false);
  assert.deepEqual(long.json.rows, []);
  assert.equal(long.json.inbox.update_id, '501');
  assert.match(long.json.reply, /too long to read/);
  const [ok] = run('parse-entry.json', 'Build request', [{ image: jpeg(576, 1280) }], nodes);
  assert.match(ok.json.body.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);
  // the If node sends a request to the LLM and anything else to the end of the sub-workflow
  const c = wf('parse-entry.json').connections;
  assert.equal(c['Build request'].main[0][0].node, 'Has request?');
  assert.deepEqual(c['Has request?'].main.map((o) => o[0].node), ['LLM', 'Rejected']);
});

test('Run command: /balance and /undo return {inbox, reply, appendRows, voidIds}', () => {
  const tx = [{ id: 'T0001', batch_id: 'B1', status: 'ok' }, { id: 'T0002', batch_id: 'B2', status: 'ok' }, { id: 'T0003', batch_id: 'B2', status: 'ok' }];
  const cmd = (text) => run('commands.json', 'Run command', [{}], { Start: [inbox({ kind: 'command', text })], Transactions: tx, Accounts: ACCOUNTS, Categories: CATEGORIES })[0].json;
  const bal = cmd('/balance');
  assert.match(bal.reply, /^Balance\n/);
  assert.deepEqual([bal.appendRows, bal.voidIds], [[], []]);
  assert.deepEqual(cmd('/undo').voidIds, ['T0002', 'T0003']);
  assert.equal(cmd('/summary 2020-01').reply, 'No entries in Jan 2020.');
  const cash = cmd('/cash 150000');
  assert.equal(cash.appendRows[0].id, 'T0004');
  assert.equal(cash.inbox.update_id, '501');
});

test('Result: rows and voids become write items carrying the Inbox update', () => {
  const ok = run('process-inbox.json', 'Result', [{ inbox: inbox(), reply: 'R', voidIds: ['T0002'], appendRows: [{ id: 'T0004' }] }]);
  assert.deepEqual(ok.map((i) => i.json.id), ['T0004', 'T0002']);
  assert.equal(ok[1].json.status, 'void');
  assert.deepEqual([ok[0].json._m.update_id, ok[0].json._m.status, ok[0].json._m.reply], ['501', 'done', 'R']);
  const confirm = run('process-inbox.json', 'Result', [{ inbox: inbox(), reply: 'R', voidIds: [], appendRows: [], okIds: ['T0016', 'T0025'] }]);
  assert.deepEqual(confirm.map((i) => [i.json.id, i.json.status]), [['T0016', 'ok'], ['T0025', 'ok']]);
  const none = run('process-inbox.json', 'Result', [{ inbox: inbox(), ok: false, reply: 'ask' }]);
  assert.deepEqual([none.length, none[0].json.status, none[0].json.reply, none[0].json.id], [1, 'done', 'ask', undefined]);
});

test('Result: sub-workflow error marks the row error with the error reply', () => {
  const [out] = run('process-inbox.json', 'Result', [{ ...inbox(), error: 'timeout' }]);
  assert.deepEqual([out.json.update_id, out.json.status, out.json.error], ['501', 'error', 'timeout']);
  assert.equal(out.json.reply, '🔴 Couldn\'t process "makan padang 25rb" (timeout). Please send it again.');
  const [m] = run('process-inbox.json', 'Save failed', [{ id: 'T0004', _m: { update_id: '501', status: 'done', input_text: 'x', reply: 'R' } }]);
  assert.deepEqual([m.json.status, m.json.update_id], ['error', '501']);
  assert.match(m.json.reply, /^🔴/);
  assert.equal(run('process-inbox.json', 'Saved', [{ id: 'T0004', _m: { status: 'done' } }])[0].json.status, 'done');
});

test('Pick: oldest first, skips while another run is busy, retakes stale rows', () => {
  const recent = new Date(Date.now() + 7 * 3600000 - 60000).toISOString().slice(0, 19) + '+07:00';
  const old = new Date(Date.now() + 7 * 3600000 - 3600000).toISOString().slice(0, 19) + '+07:00';
  const tick = [{ timestamp: new Date(Date.now() - 13000).toISOString() }];
  const pick = (rows) => run('process-inbox.json', 'Pick', rows, { Config: [config], 'Every minute': tick });
  const out = pick([{ row_number: 5, update_id: '9', status: 'new' }, { row_number: 3, update_id: '7', status: 'processing', processed_at: old }]);
  assert.deepEqual(out.map((i) => i.json.update_id), ['7', '9']);
  assert.ok(out.every((i) => i.json.status === 'processing' && i.json.config.sheetId));
  assert.deepEqual(pick([{ row_number: 5, status: 'new' }, { row_number: 3, status: 'processing', processed_at: recent }]), []);
});

test('Pick: a run that starts late (missed tick caught up after a restart) leaves the rows to the next run', () => {
  const pick = (ago) => run('process-inbox.json', 'Pick', [{ row_number: 2, update_id: '9', status: 'new' }], {
    Config: [config], 'Every minute': [{ timestamp: new Date(Date.now() - ago).toISOString() }],
  });
  assert.equal(pick(20000).length, 1);
  assert.deepEqual(pick(50000), []); // live run 88: tick 17:10:46, Pick 17:11:36
});

test('Pick: a slow Read Inbox is not a late run, until the claim could not land before the next run', () => {
  const pick = (ago) => run('process-inbox.json', 'Pick', [{ row_number: 2, update_id: '9', status: 'new' }], {
    Config: [{ ...config, startedAt: Date.now() - ago + 1000 }], 'Every minute': [{ timestamp: new Date(Date.now() - ago).toISOString() }],
  });
  assert.equal(pick(40000).length, 1); // live run 921: Read Inbox took 32 s and the run was skipped
  assert.deepEqual(pick(55000), []);
});

test('Telegram sends retry before the error is swallowed', () => {
  for (const n of wf('process-inbox.json').nodes.filter((n) => n.type === 'n8n-nodes-base.telegram')) {
    assert.deepEqual([n.retryOnFail, n.maxTries, n.onError], [true, 3, 'continueRegularOutput'], n.name);
  }
});

test('Notice and Count use the message catalog', () => {
  const notice = (n) => run('process-inbox.json', 'Notice', Array(n).fill({}));
  assert.deepEqual(notice(1), []);
  assert.equal(notice(3)[0].json.reply, '📥 Processing 3 pending messages');
  const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  const [c] = run('nudge.json', 'Count', [{ txn_date: today, status: 'ok' }, {}]);
  assert.equal(c.json.reply, '1 entry today. Anything missing?');
});

test('Build summary: the monthly send covers the month that just ended', () => {
  const last = new Date(Date.now() + 7 * 3600000);
  last.setUTCDate(0); // last day of the previous month
  const month = last.toISOString().slice(0, 7);
  const tx = [{ id: 'T0001', status: 'ok', source: 'text', txn_date: month + '-05', type: 'expense', amount: 40000, category_id: 'food', nature: 'need' }, {}];
  const [out] = run('monthly-summary.json', 'Build summary', [{}], { Transactions: tx, Accounts: ACCOUNTS, Categories: CATEGORIES });
  assert.equal(out.json.month, month);
  assert.match(out.json.reply, /^Summary · \w{3} \d{4}\nIncome · Rp0\nExpense · Rp40\.000\n/);
  assert.match(out.json.reply, /\n   Food · Rp40\.000\n/);
  const [empty] = run('monthly-summary.json', 'Build summary', [{}], { Transactions: [{}], Accounts: ACCOUNTS, Categories: CATEGORIES });
  assert.match(empty.json.reply, /^No entries in /);
  const w = wf('monthly-summary.json');
  assert.equal(w.nodes[0].parameters.rule.interval[0].expression, '0 8 1 * *');
  const send = w.nodes.find((n) => n.type === 'n8n-nodes-base.telegram');
  assert.deepEqual([send.retryOnFail, send.maxTries], [true, 3]);
});
