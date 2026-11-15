const test = require('node:test');
const assert = require('node:assert');
Object.assign(globalThis, require('../n8n/code/messages.js'));
const { validateParse } = require('../n8n/code/validate.js');
const { CATEGORIES, ACCOUNTS } = require('./sample.test.js');

const NOW = '2026-11-13T05:00:00Z'; // 12:00 in Jakarta
const INBOX = { update_id: 77, msg_date: '2026-11-13T09:30:00+07:00', kind: 'text', text: 'makan padang 25rb', file_id: '' };
const txn = (o) => ({
  type: 'expense', amount: 25000, account: 'BCA', to_account: null, category_id: 'food', nature: 'need',
  merchant: null, note: 'makan padang', txn_date: null, txn_time: null, fee: 0, irregular: false,
  items: [], receipt: null, confidence: 0.92, ...o,
});
const run = (t, inbox = {}, extra = {}) =>
  validateParse({
    parsed: { transactions: [].concat(t), missing: [], reply_hint: null, ...extra },
    inbox: { ...INBOX, ...inbox },
    categories: CATEGORIES,
    accounts: ACCOUNTS,
    nextIdNum: 123,
    now: NOW,
  });

test('happy path: spec sample, row columns and values', () => {
  const r = run(txn());
  assert.equal(r.ok, true);
  assert.equal(r.reply, '✅ Rp25.000 · Food · BCA · "makan padang" · need  (#T0123) · /undo');
  assert.deepEqual(r.rows[0], {
    id: 'T0123', inbox_update_id: 77, batch_id: 'B77', created_at: '2026-11-13T12:00:00+07:00',
    txn_date: '2026-11-13', txn_time: '09:30', type: 'expense', amount: 25000, account: 'BCA',
    to_account: '', category_id: 'food', nature: 'need', merchant: '', note: 'makan padang', items: 0,
    receipt_total: '', irregular: false, source: 'text', recurring_id: '', raw_input: 'makan padang 25rb',
    tg_file_id: '', confidence: 0.92, status: 'ok',
  });
});

test('rule 1: date and time fall back to msg_date in Jakarta; LLM values win', () => {
  assert.equal(run(txn(), { msg_date: '2026-11-01T18:00:00Z' }).rows[0].txn_date, '2026-11-02');
  assert.equal(run(txn(), { msg_date: '2026-11-01T18:00:00Z' }).rows[0].txn_time, '01:00');
  const r = run(txn({ txn_date: '2026-11-10', txn_time: '8.10' })).rows[0];
  assert.deepEqual([r.txn_date, r.txn_time], ['2026-11-10', '08:10']);
});

test('rule 1: future date is refused, today and Jakarta-today are fine', () => {
  const r = run(txn({ txn_date: '2026-11-14' }));
  assert.deepEqual(r, { ok: false, reply: '❓ That date is in the future. For upcoming payments, add a rule in the Recurring tab.' });
  assert.equal(run(txn({ txn_date: '2026-11-13' })).ok, true);
  const late = validateParse({ parsed: { transactions: [txn({ txn_date: '2026-11-14' })], missing: [] }, inbox: INBOX, categories: CATEGORIES, accounts: ACCOUNTS, nextIdNum: 1, now: '2026-11-13T18:00:00Z' });
  assert.equal(late.ok, true); // already 14 Nov in Jakarta
});

test('rule 2: default account when none given, named account wins', () => {
  assert.equal(run(txn({ account: '' })).rows[0].account, 'BCA');
  assert.equal(run(txn({ account: 'cash' }), { text: 'makan padang 25rb cash' }).rows[0].account, 'Cash');
  assert.equal(run(txn({ account: 'BNI' }), { text: 'makan padang 25rb pake bni' }).rows[0].account, 'BNI');
});

test('rule 2 guard: text message, account the text does not name -> default account', () => {
  assert.equal(run(txn({ account: 'Cash' })).rows[0].account, 'BCA');
  assert.equal(run(txn({ account: 'BNI' })).rows[0].account, 'BCA');
  assert.equal(run(txn({ account: 'Cash' })).rows[0].confidence, 0.92); // confidence untouched
});

test('rule 2 guard: "tunai" / "cash" keep Cash, whole word only', () => {
  assert.equal(run(txn({ account: 'Cash' }), { text: 'parkir ceban tunai' }).rows[0].account, 'Cash');
  assert.equal(run(txn({ account: 'Cash' }), { text: 'Bayar CASH, makan 25rb' }).rows[0].account, 'Cash');
  assert.equal(run(txn({ account: 'Cash' }), { text: 'dapat cashback 25rb' }).rows[0].account, 'BCA');
});

test('rule 2 guard: text naming exactly one account decides, whatever the model said', () => {
  assert.equal(run(txn({ account: 'BCA' }), { text: 'gojek 15rb bni' }).rows[0].account, 'BNI');
  assert.equal(run(txn({ account: '' }), { text: 'gojek 15rb bni' }).rows[0].account, 'BNI');
  assert.equal(run(txn({ account: 'BCA' }), { text: 'parkir 5rb tunai' }).rows[0].account, 'Cash');
});

test('rule 2 guard: text naming two accounts keeps the model choice', () => {
  assert.equal(run(txn({ account: 'BNI' }), { text: 'bayar bni 25rb pakai uang cash' }).rows[0].account, 'BNI');
  assert.equal(run(txn({ account: 'Cash' }), { text: 'bayar bni 25rb pakai uang cash' }).rows[0].account, 'Cash');
});

test('rule 2 guard: any distinctive word of a multi-word account name counts', () => {
  assert.equal(run(txn({ type: 'income', category_id: 'income-freelance', account: 'Koperasi' }), { text: 'bagi hasil koperasi 25rb' }).rows[0].account, 'Koperasi');
});

test('rule 2 guard: photos and transfers are exempt', () => {
  assert.equal(run(txn({ account: 'Cash' }), { kind: 'photo', text: '' }).rows[0].account, 'Cash');
  const r = run(txn({ type: 'transfer', account: 'BCA', to_account: 'Cash', category_id: null, nature: null, amount: 500000 }), { text: 'tarik atm 500rb' });
  assert.deepEqual([r.rows[0].account, r.rows[0].to_account], ['BCA', 'Cash']);
  assert.equal(run(txn({ type: 'transfer', account: 'BNI', to_account: 'Cash', category_id: null, nature: null }), { text: 'tarik 25rb' }).rows[0].account, 'BNI');
});

test('rule 3: transfer with fee adds a bank-fee expense row in the same batch', () => {
  const r = run(txn({ type: 'transfer', account: 'BCA', to_account: 'BNI', category_id: null, nature: null, amount: 500000, fee: 6500, note: 'to bni' }));
  assert.equal(r.rows.length, 2);
  const [main, fee] = r.rows;
  assert.deepEqual([main.type, main.to_account, main.category_id, main.nature, main.amount], ['transfer', 'BNI', '', '', 500000]);
  assert.deepEqual([fee.type, fee.amount, fee.account, fee.category_id, fee.batch_id, fee.to_account, fee.nature], ['expense', 6500, 'BCA', 'bank-fee', 'B77', '', 'need']);
  assert.deepEqual([main.id, fee.id], ['T0123', 'T0124']);
  assert.equal(r.reply.split('\n').length, 2);
  assert.match(r.reply.split('\n')[0], /BCA → BNI/);
});

test('rule 3: no fee row when fee is 0', () => {
  assert.equal(run(txn({ type: 'transfer', to_account: 'BNI', category_id: null, fee: 0 })).rows.length, 1);
});

test('rule 4/5: ATM withdrawal and investing are transfers without category', () => {
  const atm = run(txn({ type: 'transfer', to_account: 'Cash', category_id: null, nature: 'want' })).rows[0];
  assert.deepEqual([atm.type, atm.account, atm.to_account, atm.nature], ['transfer', 'BCA', 'Cash', '']);
  const inv = run(txn({ type: 'transfer', to_account: 'Investment', category_id: 'food' })).rows[0];
  assert.deepEqual([inv.to_account, inv.category_id], ['Investment', '']);
});

test('rule 6: need/want precedence tag > category default > LLM; blank for income and transfer', () => {
  const nat = (t, text) => run(t, { text }).rows[0].nature;
  assert.equal(nat(txn({ category_id: 'food', nature: 'want' }), 'kopi 20rb'), 'want'); // blank default: LLM
  assert.equal(nat(txn({ category_id: 'game', nature: 'need' }), 'game 20rb'), 'want'); // default beats LLM
  assert.equal(nat(txn({ category_id: 'game', nature: 'want' }), 'game 20rb #need'), 'need'); // tag beats default
  assert.equal(nat(txn({ category_id: 'food', nature: 'need' }), 'kopi 20rb #WANT'), 'want');
  assert.equal(nat(txn({ category_id: 'food', nature: null }), 'kopi 20rb'), '');
  assert.equal(nat(txn({ type: 'income', category_id: 'income-salary', nature: 'need' }), 'gaji 5jt #need'), '');
});

test('rule 7: positive whole rupiah', () => {
  assert.equal(run(txn({ amount: -25000.4 })).rows[0].amount, 25000);
  assert.equal(run(txn({ amount: '25000' })).rows[0].amount, 25000);
  assert.match(run(txn({ amount: 0 })).reply, /^❓ How much was it\?/);
});

test('rule 9: validation failures ask and write nothing', () => {
  const bad = (t) => {
    const r = run(t);
    assert.equal(r.ok, false);
    assert.equal(r.rows, undefined);
    return r.reply;
  };
  assert.match(bad(txn({ account: 'Mandiri' })), /don't know the account "Mandiri"/);
  assert.match(bad(txn({ category_id: 'income-stock', type: 'income' })), /"income-stock" is missing or inactive/);
  assert.match(bad(txn({ category_id: 'nope' })), /"nope"/);
  assert.match(bad(txn({ category_id: 'income-salary' })), /"income-salary"/); // income category on an expense
  assert.equal(run(txn({ category_id: 'unrecorded-cash' })).ok, true); // type "both" fits either
  assert.match(bad(txn({ category_id: null })), /missing or inactive/);
  assert.match(bad(txn({ type: 'transfer', to_account: null })), /Which account did the money go to/);
  assert.match(bad(txn({ type: 'transfer', to_account: 'Mandiri' })), /don't know the account "Mandiri"/);
  assert.match(bad(txn({ type: 'transfer', account: 'BNI', to_account: 'bni' })), /two different accounts/);
});

test('missing fields ask instead of writing', () => {
  const amount = run([], {}, { missing: ['amount'] });
  assert.deepEqual(amount, { ok: false, reply: '❓ How much was it? Reply with the amount, e.g. "makan padang 25rb 18rb".' });
  const other = run([], {}, { missing: ['account'], reply_hint: 'which bank?' });
  assert.equal(other.ok, false);
  assert.match(other.reply, /account.*which bank\?/);
  assert.equal(run([]).ok, false);
});

test('rule 11: #irregular tag or LLM flag', () => {
  assert.equal(run(txn(), { text: 'pajak motor 300rb #irregular' }).rows[0].irregular, true);
  assert.equal(run(txn({ irregular: true })).rows[0].irregular, true);
  assert.equal(run(txn()).rows[0].irregular, false);
});

test('confidence below 0.7 saves as needs_review, 0.7 is ok', () => {
  const low = run(txn({ confidence: 0.69, type: 'transfer', to_account: 'BNI', fee: 1000 }));
  assert.deepEqual(low.rows.map((r) => r.status), ['needs_review', 'needs_review']);
  assert.ok(low.reply.startsWith('⚠️'));
  assert.ok(low.reply.endsWith('\nAll correct? Send /ok. Otherwise /review shows how to fix them.')); // the reply says how to answer
  assert.ok(!run(txn({ confidence: 0.7 })).reply.includes('/ok'));
  assert.equal(run(txn({ confidence: 0.7 })).rows[0].status, 'ok');
});

test('photo: source, items, receipt_total, file id, printed time', () => {
  const items = [{ no: 1, name: 'A', price: 10000, selected: true }, { no: 2, name: 'B', price: 15000, selected: true }];
  const r = run(txn({ items, receipt: { subtotal: 25000, tax: 2500, service: 0, discount: 0, total: 27500 }, amount: 27500, txn_time: '19:30' }), { kind: 'photo', file_id: 'AgAC', text: '' }).rows[0];
  assert.deepEqual([r.source, r.items, r.receipt_total, r.tg_file_id, r.txn_time, r.raw_input], ['photo', 2, 27500, 'AgAC', '19:30', '']);
  assert.equal(run(txn({ receipt: { subtotal: 0, tax: 0, service: 0, discount: 0, total: 0 } })).rows[0].receipt_total, '');
});

test('ids continue from nextIdNum and pad to at least 4 digits', () => {
  const ids = (n) => validateParse({ parsed: { transactions: [txn({ type: 'transfer', to_account: 'BNI', fee: 1 })], missing: [] }, inbox: INBOX, categories: CATEGORIES, accounts: ACCOUNTS, nextIdNum: n, now: NOW }).rows.map((r) => r.id);
  assert.deepEqual(ids(1), ['T0001', 'T0002']);
  assert.deepEqual(ids(9999), ['T9999', 'T10000']);
  assert.deepEqual(ids('42'), ['T0042', 'T0043']);
});

test('tolerates Sheets coercion: "TRUE" strings, empty cells, missing fields', () => {
  const cats = CATEGORIES.map((c) => ({ ...c, active: c.active === true ? 'TRUE' : String(c.active).toUpperCase(), default_nature: c.default_nature || undefined }));
  const accs = ACCOUNTS.map((a) => ({ ...a, is_default: a.is_default || undefined }));
  const r = validateParse({ parsed: { transactions: [txn({ account: '' })], missing: [] }, inbox: { update_id: '5', msg_date: INBOX.msg_date, text: undefined }, categories: cats, accounts: accs, nextIdNum: '10', now: NOW });
  assert.equal(r.ok, true);
  assert.deepEqual([r.rows[0].id, r.rows[0].account, r.rows[0].batch_id, r.rows[0].raw_input], ['T0010', 'BCA', 'B5', '']);
});

test('names in missing do not block an entry the model filled in', () => {
  assert.equal(run(txn(), {}, { missing: ['merchant', 'txn_time'] }).ok, true);
  assert.equal(run(txn({ type: 'transfer', to_account: 'BNI', category_id: null }), { text: 'transfer 25rb ke bni' }, { missing: ['amount', 'type'] }).ok, true);
});

test('a text message without a stated amount asks, whatever amount the model returns', () => {
  assert.match(run(txn(), { text: 'kopi kemarin' }).reply, /How much was it/);
  assert.equal(run(txn(), { text: 'parkir goceng' }).ok, true);
  assert.equal(run(txn(), { kind: 'photo', text: 'makan siang' }).ok, true);
});

test('a fee returned twice (fee field and its own bank-fee row) is written once', () => {
  const r = run([txn({ type: 'transfer', to_account: 'Koperasi', category_id: null, amount: 2000000, fee: 2500 }), txn({ category_id: 'bank-fee', amount: 2500 })], { text: 'transfer ke Koperasi 2jt, biaya admin 2500' });
  assert.deepEqual(r.rows.map((x) => [x.type, x.amount, x.category_id]), [['transfer', 2000000, ''], ['expense', 2500, 'bank-fee']]);
  assert.equal(run(txn({ category_id: 'bank-fee', amount: 2500 }), { text: 'biaya admin 2500' }).rows.length, 1);
});

test('e-wallet top-up with a stated purpose takes the purpose category', () => {
  const cat = (text) => run(txn({ category_id: 'e-wallet-top-up' }), { text }).rows[0].category_id;
  assert.equal(cat('topup gopay 50rb buat gojek'), 'transport-ojol-bensin');
  assert.equal(cat('topup gopay 50rb'), 'e-wallet-top-up');
  assert.equal(cat('topup gopay 50rb buat gojek dan makan'), 'e-wallet-top-up');
});

test('annual words in the text mark the entry irregular', () => {
  assert.equal(run(txn(), { text: 'bayar pajak motor 400rb' }).rows[0].irregular, true);
  assert.equal(run(txn()).rows[0].irregular, false);
});

test('transfer screenshot: a total that includes the fee is not counted twice', () => {
  const r = run(txn({ type: 'transfer', to_account: 'BNI', category_id: null, amount: 102500, fee: 2500, receipt: { subtotal: 0, tax: 0, service: 0, discount: 0, total: 102500 } }), { kind: 'photo', text: 'pindah ke bni' });
  assert.deepEqual(r.rows.map((x) => x.amount), [100000, 2500]);
  const plain = run(txn({ type: 'transfer', to_account: 'BNI', category_id: null, amount: 100000, fee: 2500 }), { text: 'transfer 100rb ke bni' });
  assert.deepEqual(plain.rows.map((x) => x.amount), [100000, 2500]);
});

test('photo saved as a transfer without the destination in the caption needs review', () => {
  const t = txn({ type: 'transfer', to_account: 'BNI', category_id: null });
  const blind = run(t, { kind: 'photo', text: '' });
  assert.equal(blind.rows[0].status, 'needs_review');
  assert.match(blind.reply, /saved as a transfer to your own BNI/);
  assert.equal(run(t, { kind: 'photo', text: 'pindah ke bni' }).rows[0].status, 'ok');
  assert.equal(run(t, { text: 'transfer 25rb ke bni' }).rows[0].status, 'ok');
});

test('a text message without a year means the latest such day, whatever year the model returns', () => {
  const day = (d, text, o = {}) => run(txn({ txn_date: d }), { text, ...o }).rows[0].txn_date;
  assert.equal(day('2023-10-20', 'kopi 18rb tgl 20 oktober'), '2026-10-20'); // seen live: the model answered 2023
  assert.equal(day('2023-12-25', 'kado 200rb 25 desember'), '2025-12-25'); // not yet this year: last year
  assert.equal(day('2026-11-12', 'kopi 18rb kemarin'), '2026-11-12');
  assert.equal(day('2025-12-31', 'kopi 18rb kemarin', { msg_date: '2026-01-01T08:00:00+07:00' }), '2025-12-31');
  assert.equal(day('2024-02-29', 'kopi 18rb 29 feb'), '2024-02-29'); // no 29 Feb in 2026 or 2025: left alone, flagged as old
  // a year in the text, or a photo with a printed date, is taken as given
  assert.equal(day('2023-10-20', 'kopi 18rb 20 oktober 2023'), '2023-10-20');
  assert.equal(day('2023-10-20', 'kopi 18rb 20/10/23'), '2023-10-20');
  assert.equal(day('2025-10-20', 'kopi 18rb oktober tahun lalu'), '2025-10-20');
  assert.equal(day('2023-10-20', '', { kind: 'photo', file_id: 'F' }), '2023-10-20');
});

test('dates: impossible ones fall back to the message date, old or pre-opening ones need review', () => {
  assert.equal(run(txn({ txn_date: '2026-02-31' })).rows[0].txn_date, '2026-11-13');
  assert.equal(run(txn({ txn_time: '25:99' })).rows[0].txn_time, '09:30');
  const old = run(txn({ txn_date: '2025-11-05' }), { text: 'makan padang 25rb 5 nov 2025' });
  assert.equal(old.rows[0].status, 'needs_review');
  assert.match(old.reply, /Check the date: 5 Nov 2025/);
  const accs = ACCOUNTS.map((a) => ({ ...a, opening_date: '2026-10-28' }));
  const at = (d) => validateParse({ parsed: { transactions: [txn({ txn_date: d })], missing: [] }, inbox: INBOX, categories: CATEGORIES, accounts: accs, nextIdNum: 1, now: NOW });
  assert.equal(at('2026-10-29').rows[0].status, 'ok');
  assert.equal(at('2026-10-28').rows[0].status, 'needs_review');
  assert.match(at('2026-10-28').reply, /on or before the BCA opening balance \(28 Oct 2026\)/);
});

test('an unparseable Inbox.msg_date is an error, never the processing time', () => {
  assert.throws(() => run(txn(), { msg_date: 'not a date' }), /msg_date is not a date/);
});
