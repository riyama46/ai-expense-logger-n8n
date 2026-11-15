function cTrue(x) {
  return x === true || String(x).toUpperCase() === 'TRUE';
}

function cNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function cIdNum(row) {
  return parseInt(String(row.id).replace(/\D/g, ''), 10) || 0;
}

// "150000", "150.000", "150,000.00", "150rb", "1,5jt" -> integer rupiah, or null
function cParseAmount(arg) {
  const m = /^(?:rp|idr)?\s*(\d+(?:[.,]\d+)*)\s*(rb|k|ribu|jt|juta)?$/i.exec(String(arg || '').trim());
  if (!m) return null;
  // cents ("100.000,00", "150,000.00", "150000.00") are dropped; every other separator groups thousands
  if (!m[2]) return Number(m[1].replace(/[.,]\d{2}$/, '').replace(/[.,]/g, ''));
  const mult = /^(jt|juta)$/i.test(m[2]) ? 1e6 : 1e3;
  // with a suffix a separator is a decimal ("1,5jt"), unless it groups thousands ("1.500rb")
  const num = /^\d{1,3}([.,]\d{3})+$/.test(m[1]) ? m[1].replace(/[.,]/g, '') : m[1].replace(',', '.');
  return Math.round(Number(num) * mult);
}

function cStatus(t) {
  return String(t.status).toLowerCase();
}

function cById(a, b) {
  return cIdNum(a) - cIdNum(b);
}

// "25", "T0025", "#t25", separated by spaces or commas -> {rows, unknown: [token]}
function cPick(arg, transactions) {
  const rows = [];
  const unknown = [];
  for (const token of String(arg || '').split(/[\s,]+/).filter(Boolean)) {
    const m = /^#?t?0*(\d+)$/i.exec(token);
    const row = m && transactions.find((t) => cIdNum(t) === Number(m[1]));
    if (!row) unknown.push(token);
    else if (!rows.includes(row)) rows.push(row);
  }
  return { rows, unknown };
}

// With ids: void exactly those entries, or nothing when one of them is unknown or already void
function cUndoIds(arg, transactions) {
  const { rows, unknown } = cPick(arg, transactions);
  const bad = [...unknown, ...rows.filter((t) => cStatus(t) === 'void').map((t) => '#' + t.id)];
  if (bad.length) return { reply: MSG.badIds(bad, 'void'), appendRows: [], voidIds: [] };
  const voidIds = rows.map((t) => t.id);
  return { reply: MSG.voided(voidIds), appendRows: [], voidIds };
}

function cReview(transactions) {
  const rows = transactions.filter((t) => cStatus(t) === 'needs_review').sort(cById);
  return { reply: rows.length ? MSG.reviewList(rows) : MSG.reviewNone(), appendRows: [], voidIds: [] };
}

// No ids: confirm every entry that needs review. With ids: exactly those, or nothing when one is not waiting
function cOk(arg, transactions) {
  const none = { appendRows: [], voidIds: [], okIds: [] };
  let rows = transactions.filter((t) => cStatus(t) === 'needs_review').sort(cById);
  if (String(arg || '').trim()) {
    const pick = cPick(arg, transactions);
    const bad = [...pick.unknown, ...pick.rows.filter((t) => cStatus(t) !== 'needs_review').map((t) => '#' + t.id)];
    if (bad.length) return { ...none, reply: MSG.badIds(bad, 'confirm') };
    rows = pick.rows;
  }
  if (!rows.length) return { ...none, reply: MSG.reviewNone() };
  const okIds = rows.map((t) => t.id);
  return { ...none, reply: MSG.confirmed(okIds), okIds };
}

// Newest first; 5 unless a number is given
function cLast(arg, transactions) {
  const n = Math.min(Math.max(parseInt(arg, 10) || 5, 1), 30);
  const rows = transactions.filter((t) => cStatus(t) !== 'void').sort(cById).reverse().slice(0, n);
  return { reply: MSG.last(rows), appendRows: [], voidIds: [] };
}

function cUndo(transactions) {
  const live = transactions.filter((t) => String(t.status).toLowerCase() !== 'void');
  if (!live.length) return { reply: MSG.nothingToVoid(), appendRows: [], voidIds: [] };
  const last = live.reduce((a, b) => (cIdNum(b) > cIdNum(a) ? b : a));
  const batch = live.filter((t) => t.id === last.id || (last.batch_id && t.batch_id === last.batch_id));
  const voidIds = batch.map((t) => t.id);
  return { reply: MSG.voided(voidIds), appendRows: [], voidIds };
}

function cBalance(accounts) {
  const rows = accounts.map((a) => ({ account: a.account, balance: cNum(a.balance), liquid: cTrue(a.liquid) }));
  const total = rows.filter((a) => a.liquid).reduce((sum, a) => sum + a.balance, 0);
  return { reply: MSG.balance(rows, total), appendRows: [], voidIds: [] };
}

function cCash(arg, { accounts, nextIdNum, inbox, now, text }) {
  const real = cParseAmount(arg);
  if (real === null) return { reply: MSG.cashUsage(), appendRows: [], voidIds: [] };
  const cash = accounts.find((a) => String(a.account).toLowerCase() === 'cash');
  const diff = real - cNum(cash && cash.balance);
  if (!diff) return { reply: MSG.cashMatches(real), appendRows: [], voidIds: [] };

  const j = new Date(Date.parse(now) + 7 * 3600000).toISOString();
  const id = 'T' + String(Number(nextIdNum)).padStart(4, '0');
  const row = {
    id,
    inbox_update_id: inbox.update_id,
    batch_id: 'B' + inbox.update_id,
    created_at: j.slice(0, 19) + '+07:00',
    txn_date: j.slice(0, 10),
    txn_time: j.slice(11, 16),
    type: diff < 0 ? 'expense' : 'income',
    amount: Math.abs(diff),
    account: 'Cash',
    to_account: '',
    category_id: 'unrecorded-cash',
    nature: '',
    merchant: '',
    note: 'Cash count adjustment',
    items: '',
    receipt_total: '',
    irregular: false,
    source: 'adjustment',
    recurring_id: '',
    raw_input: text,
    tg_file_id: '',
    confidence: 1,
    status: 'ok',
  };
  return { reply: MSG.cashAdjusted(real, diff, id), appendRows: [row], voidIds: [] };
}

// 'YYYY-MM' moved by n months
function cMonthAdd(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

function cDay(t) {
  return String(t.txn_date).slice(0, 10);
}

function cSum(rows) {
  return rows.reduce((sum, t) => sum + cNum(t.amount), 0);
}

// [{name, amount}] largest first, from rows grouped by key(row)
function cTotals(rows, key) {
  const map = new Map();
  for (const t of rows) map.set(key(t), (map.get(key(t)) || 0) + cNum(t.amount));
  return [...map].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
}

// arg: '' (the current month in Jakarta) or 'YYYY-MM'. All totals are computed here, never by the LLM.
function cSummary(arg, { transactions, categories, accounts, now }) {
  const none = { appendRows: [], voidIds: [] };
  const today = new Date(Date.parse(now) + 7 * 3600000).toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);
  const month = String(arg || '').trim() || thisMonth;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { ...none, reply: MSG.summaryUsage() };

  const cats = {};
  for (const c of categories || []) cats[c.id] = c;
  const name = (t) => (cats[t.category_id] || {}).name || t.category_id;
  const group = (t) => (cats[t.category_id] || {}).group || 'Other';
  const isType = (type) => (t) => String(t.type).toLowerCase() === type;
  const nature = (n) => (t) => String(t.nature || '').toLowerCase() === n;

  const live = transactions.filter((t) => cStatus(t) !== 'void' && t.source !== 'opening');
  const rows = live.filter((t) => cDay(t).slice(0, 7) === month);
  if (!rows.length) return { ...none, reply: MSG.summaryEmpty(month) };
  const allExpenses = live.filter(isType('expense'));
  const expenses = rows.filter(isType('expense'));
  const incomes = rows.filter(isType('income'));
  const wants = expenses.filter(nature('want'));

  const weekend = (t) => [0, 6].includes(new Date(cDay(t) + 'T00:00:00Z').getUTCDay());
  const bucket = (t) => {
    const h = parseInt(String(t.txn_time || '').slice(0, 2), 10);
    if (!(h >= 0 && h <= 23)) return '';
    return h < 5 || h >= 22 ? 'night' : h < 11 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  };

  // 12 months ending with the summary month
  const from = cMonthAdd(month, -11);
  const irregular12 = allExpenses.filter((t) => cTrue(t.irregular) && cDay(t).slice(0, 7) >= from && cDay(t).slice(0, 7) <= month);

  // Runway: liquid total / average "need" expense of the last 3 full months that have entries behind them
  const openings = (accounts || []).map((a) => String(a.opening_date || '').slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  const start = (openings.length ? openings : live.map(cDay)).sort()[0];
  const fullMonths = [-3, -2, -1].map((n) => cMonthAdd(thisMonth, n)).filter((ym) => start && ym + '-01' >= start);
  const needs = allExpenses.filter((t) => nature('need')(t) && fullMonths.includes(cDay(t).slice(0, 7)));
  const liquid = cSum((accounts || []).filter((a) => cTrue(a.liquid)).map((a) => ({ amount: a.balance })));

  return {
    ...none,
    reply: MSG.summary({
      month,
      to: month === thisMonth ? today : '',
      income: cSum(incomes),
      expense: cSum(expenses),
      groups: cTotals(expenses, group).map((g) => ({ ...g, subs: cTotals(expenses.filter((t) => group(t) === g.name), name) })),
      need: cSum(expenses.filter(nature('need'))),
      want: cSum(wants),
      topWant: cTotals(wants, name).slice(0, 3),
      wantWeekday: cSum(wants.filter((t) => !weekend(t))),
      wantWeekend: cSum(wants.filter(weekend)),
      wantTimes: ['morning', 'afternoon', 'evening', 'night']
        .map((b) => ({ name: b, amount: cSum(wants.filter((t) => bucket(t) === b)) }))
        .filter((b) => b.amount),
      irregular: expenses
        .filter((t) => cTrue(t.irregular))
        .map((t) => ({ txn_date: cDay(t), amount: cNum(t.amount), name: name(t), label: t.note || t.merchant || '' })),
      irregularAvg: cSum(irregular12) / 12,
      freelance: cSum(incomes.filter((t) => t.category_id === 'income-freelance')),
      review: rows.filter((t) => cStatus(t) === 'needs_review').length,
      liquid,
      fullMonths: fullMonths.length,
      needAvg: fullMonths.length ? cSum(needs) / fullMonths.length : 0,
    }),
  };
}

function runCommand({ text, transactions, accounts, categories, nextIdNum, inbox, now }) {
  const m = /^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(String(text || '').trim());
  const cmd = m ? m[1].toLowerCase() : '';
  if (cmd === 'undo') return String(m[2] || '').trim() ? cUndoIds(m[2], transactions) : cUndo(transactions);
  if (cmd === 'review') return cReview(transactions);
  if (cmd === 'ok') return cOk(m[2], transactions);
  if (cmd === 'last') return cLast(m[2], transactions);
  if (cmd === 'summary') return cSummary(m[2], { transactions, categories, accounts, now });
  if (cmd === 'balance') return cBalance(accounts);
  if (cmd === 'cash') return cCash(m[2], { accounts, nextIdNum, inbox, now, text });
  if (cmd === 'help') return { reply: MSG.help(), appendRows: [], voidIds: [] };
  return { reply: MSG.unknownCommand(), appendRows: [], voidIds: [] };
}

// Entries dated today that the user logged (not void, not opening or adjustment rows)
function countToday(transactions, today) {
  return transactions.filter(
    (t) =>
      String(t.txn_date).slice(0, 10) === today &&
      String(t.status).toLowerCase() !== 'void' &&
      t.source !== 'opening' &&
      t.source !== 'adjustment',
  ).length;
}

if (typeof module !== 'undefined') module.exports = { runCommand, countToday };
