// Receipt split and statement import with dedupe
const test = require('node:test');
const assert = require('node:assert');
Object.assign(globalThis, require('../n8n/code/messages.js'));
const { validateParse } = require('../n8n/code/validate.js');
const { buildLlmRequest } = require('../n8n/code/prompt.js');
const { CATEGORIES, ACCOUNTS } = require('./sample.test.js');

const NOW = '2026-11-13T05:00:00Z'; // 12:00 in Jakarta
const PHOTO = { update_id: 77, msg_date: '2026-11-13T09:30:00+07:00', kind: 'photo', text: '', file_id: 'AgAC' };
const txn = (o) => ({
  type: 'expense', amount: 25000, account: 'BCA', to_account: null, category_id: 'food', nature: 'need',
  merchant: null, note: null, txn_date: '2026-11-12', txn_time: null, fee: 0, irregular: false,
  items: [], receipt: null, confidence: 0.92, ...o,
});
const run = (t, inbox = {}, transactions = []) =>
  validateParse({
    parsed: { transactions: [].concat(t), missing: [], reply_hint: null },
    inbox: { ...PHOTO, ...inbox },
    categories: CATEGORIES,
    accounts: ACCOUNTS,
    transactions,
    nextIdNum: 201,
    now: NOW,
  });

const ITEMS = [
  { no: 1, name: 'Nasi goreng', price: 30000, selected: false },
  { no: 2, name: 'Mie ayam', price: 25000, selected: true },
  { no: 3, name: 'Es teh', price: 5000, selected: true },
  { no: 4, name: 'Sate', price: 40000, selected: false },
];
const RECEIPT = { subtotal: 100000, tax: 10000, service: 5000, discount: 0, total: 115000 };
const bill = (o) => txn({ amount: 115000, items: ITEMS, receipt: RECEIPT, merchant: 'Warung', ...o });

test('split: share = picked items + their part of tax and service', () => {
  const r = run(bill(), { text: 'items 2 and 3' });
  const row = r.rows[0];
  // 30000 + 15000 x 30000 / 100000
  assert.deepEqual([row.amount, row.receipt_total, row.items, row.status, row.source], [34500, 115000, 2, 'ok', 'photo']);
  assert.equal(r.reply, [
    '✅ Rp34.500 · Food · BCA · "Warung" · need  (#T0201) · /undo',
    'Split: 2 items Rp30.000 + tax and service share Rp4.500 = Rp34.500 of the Rp115.000 bill (Mie ayam, Es teh).',
  ].join('\n'));
});

test('split: a discount lowers the share, and rounding is to whole rupiah', () => {
  const r = run(bill({ amount: 90000, receipt: { ...RECEIPT, tax: 0, service: 0, discount: 10000, total: 90000 } }), { text: 'aku mie ayam sama es teh' });
  assert.equal(r.rows[0].amount, 27000);
  assert.match(r.reply, /Split: 2 items Rp30\.000 − discount share Rp3\.000 = Rp27\.000 of the Rp90\.000 bill/);
  const odd = run(bill({ amount: 110001, receipt: { ...RECEIPT, service: 1, total: 110001 } }), { text: 'items 2 and 3' });
  assert.equal(odd.rows[0].amount, 33000); // 30000 + 10001 x 0.3 = 33000.3
});

test('split: without a subtotal the item prices are the subtotal; a mismatch needs review', () => {
  const noSub = run(bill({ receipt: { ...RECEIPT, subtotal: 0 } }), { text: 'no 2,3' });
  assert.deepEqual([noSub.rows[0].amount, noSub.rows[0].status], [34500, 'ok']);
  const off = run(bill({ items: ITEMS.slice(1) }), { text: 'no 2,3' }); // one line was not read
  assert.equal(off.rows[0].status, 'needs_review');
  assert.match(off.reply, /Check the split: the item prices do not add up/);
});

test('split: the model listed only the picked items (live 2026-11-16)', () => {
  const picked = [{ no: 2, name: 'Es Teh Manis', price: 10000, selected: true }, { no: 3, name: 'Ayam Bakar', price: 50000, selected: true }];
  const receipt = { subtotal: 100000, tax: 0, service: 5000, discount: 0, total: 115500 };
  const r = run(bill({ amount: 115500, items: picked, receipt }), { text: 'items 2 and 3' });
  // 60000 + 15500 x 60000 / 100000
  assert.deepEqual([r.rows[0].amount, r.rows[0].receipt_total, r.rows[0].status], [69300, 115500, 'needs_review']);
  assert.match(r.reply, /Check the split/);
  // without a pick by number the same answer is one full bill
  assert.equal(run(bill({ amount: 115500, items: picked, receipt }), { text: 'makan sama klien' }).rows[0].amount, 115500);
});

test('no split: no caption, everything picked, nothing picked, or not a photo', () => {
  assert.equal(run(bill(), { text: '' }).rows[0].amount, 115000);
  const all = ITEMS.map((i) => ({ ...i, selected: true }));
  assert.deepEqual([run(bill({ items: all }), { text: 'makan' }).rows[0].amount, run(bill({ items: all }), { text: 'makan' }).rows[0].items], [115000, 4]);
  const none = ITEMS.map((i) => ({ ...i, selected: false }));
  assert.equal(run(bill({ items: none }), { text: 'makan' }).rows[0].amount, 115000);
  assert.equal(run(bill(), { kind: 'text', text: 'makan 115rb items 2 and 3' }).rows[0].amount, 115000);
  assert.doesNotMatch(run(bill(), { text: '' }).reply, /Split/);
});

test('the photo prompt asks for picked items and leaves the sum to the code', () => {
  const body = buildLlmRequest({ kind: 'photo', text: 'items 2 and 3', imageDataUrl: 'data:image/jpeg;base64,AA', msgDate: PHOTO.msg_date, categories: CATEGORIES, accounts: ACCOUNTS, model: 'm' });
  assert.match(body.messages[0].content, /set selected true for exactly those items and false for all the others/);
  assert.match(body.messages[0].content, /amount is always the full printed total/);
});

const LEDGER = [
  { id: 'T0100', type: 'expense', amount: 25000, account: 'BCA', to_account: '', txn_date: '2026-11-12', status: 'ok' },
  { id: 'T0101', type: 'expense', amount: 54000, account: 'BCA', to_account: '', txn_date: '2026-11-10', status: 'ok' },
  { id: 'T0102', type: 'expense', amount: 70000, account: 'BCA', to_account: '', txn_date: '2026-11-12', status: 'void' },
  { id: 'T0103', type: 'transfer', amount: 500000, account: 'BCA', to_account: 'Cash', txn_date: '2026-11-11', status: 'needs_review' },
  { id: 'T0104', type: 'income', amount: 9000000, account: 'BCA', to_account: '', txn_date: '2026-11-12', status: 'ok' },
  { id: 'T0105', type: 'expense', amount: 30000, account: 'BNI', to_account: '', txn_date: '2026-11-12', status: 'ok' },
];

test('statement: rows already logged are skipped (same account, amount, date within a day)', () => {
  const r = run(
    [
      txn({ amount: 25000, merchant: 'A' }), // T0100, same day
      txn({ amount: 54000, merchant: 'B', txn_date: '2026-11-11' }), // T0101, one day off
      txn({ amount: 54000, merchant: 'C', txn_date: '2026-11-12' }), // two days from T0101: new
      txn({ amount: 70000, merchant: 'D' }), // T0102 is void: new
      txn({ amount: 500000, merchant: 'ATM', txn_date: '2026-11-11' }), // logged as a transfer out of BCA
      txn({ type: 'income', amount: 9000000, category_id: 'income-salary', nature: null, merchant: 'PT' }), // T0104
      txn({ amount: 30000, merchant: 'E' }), // T0105 is on BNI: new on BCA
      txn({ amount: 9000000, merchant: 'F' }), // an expense never matches the income T0104
    ],
    {},
    LEDGER,
  );
  assert.deepEqual(r.rows.map((x) => [x.id, x.merchant, x.source]), [['T0201', 'C', 'statement'], ['T0202', 'D', 'statement'], ['T0203', 'E', 'statement'], ['T0204', 'F', 'statement']]);
  assert.equal(r.reply.split('\n')[0], '8 rows: 4 already logged, 4 added (#T0201-T0204). /undo removes this batch.');
  assert.equal(r.reply.split('\n').length, 5);
  assert.doesNotMatch(r.reply, /· \/undo$/m);
});

test('statement: one logged entry answers for one row, so two equal payments stay two', () => {
  const r = run([txn({ merchant: 'A' }), txn({ merchant: 'A' })], {}, LEDGER);
  assert.equal(r.rows.length, 1);
  assert.match(r.reply, /^2 rows: 1 already logged, 1 added \(#T0201\)\./);
});

test('statement: everything already logged writes nothing', () => {
  const r = run([txn({ merchant: 'A' }), txn({ amount: 54000, txn_date: '2026-11-10' })], {}, LEDGER);
  assert.deepEqual([r.ok, r.rows], [true, []]);
  assert.equal(r.reply, '2 rows: 2 already logged, 0 added. Nothing was saved.');
});

test('statement: one row with the caption, the named account, and an incoming transfer', () => {
  const one = run(txn({ merchant: 'A' }), { text: 'statement' }, LEDGER);
  assert.equal(one.reply, '1 row: 1 already logged, 0 added. Nothing was saved.');
  // the same single row without the caption is a normal receipt and is saved
  assert.equal(run(txn({ merchant: 'A' }), { text: '' }, LEDGER).rows.length, 1);
  const bni = run(txn({ amount: 30000 }), { text: 'mutasi bni' }, LEDGER);
  assert.equal(bni.reply, '1 row: 1 already logged, 0 added. Nothing was saved.');
  // money arriving in Cash that was logged as BCA -> Cash
  const cash = run(txn({ type: 'income', amount: 500000, account: 'Cash', category_id: 'income-salary', nature: null, txn_date: '2026-11-11' }), { text: 'statement' }, LEDGER);
  assert.equal(cash.rows.length, 0);
});

test('statement: a text message with several entries is not a statement', () => {
  const r = run([txn({ merchant: 'A' }), txn({ amount: 54000, txn_date: '2026-11-10' })], { kind: 'text', text: 'makan 25rb, netflix 54rb', file_id: '' }, LEDGER);
  assert.deepEqual(r.rows.map((x) => x.source), ['text', 'text']);
});
