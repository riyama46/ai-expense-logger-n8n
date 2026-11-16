const VALIDATE_MIN_CONFIDENCE = 0.7;
// A text message states an amount with a digit or one of these words; without either the model made the amount up
const VALIDATE_AMOUNT_WORDS = /\d|\b(ceban|goceng|gocap|gopek|cepek|seceng|noban|goban|sejuta|seribu|seratus|sepuluh|ribu|juta)\b/i;
const VALIDATE_ANNUAL = /#irregular\b|\b(pajak|stnk|tahunan|annual|yearly)\b/i;
const VALIDATE_OLD_DAYS = 60;

function vTrue(x) {
  return x === true || String(x).toUpperCase() === 'TRUE';
}

function vNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

// Asia/Jakarta is fixed UTC+7: returns 'YYYY-MM-DDTHH:MM:SS' shifted to Jakarta, or null
function vJakarta(iso) {
  const ms = Date.parse(iso);
  return isNaN(ms) ? null : new Date(ms + 7 * 3600000).toISOString().slice(0, 19);
}

function vFind(list, key, value) {
  const v = String(value || '').trim().toLowerCase();
  return v ? list.find((x) => String(x[key]).trim().toLowerCase() === v) : undefined;
}

// True when the message names the account (any word of its name, whole word; "tunai" also means Cash)
function vNamed(text, account) {
  const words = account.toLowerCase().split(/\s+/);
  if (account.toLowerCase() === 'cash') words.push('tunai');
  const t = String(text || '').toLowerCase();
  return words.some((w) => new RegExp('(^|[^a-z0-9])' + w.replace(/[^a-z0-9]/g, '\\$&') + '($|[^a-z0-9])').test(t));
}

// True when the text has the phrase as whole words
function vHasWord(text, phrase) {
  const p = String(phrase || '').trim().toLowerCase();
  return !!p && new RegExp('(^|[^a-z0-9])' + p.replace(/[^a-z0-9]/g, '\\$&') + '($|[^a-z0-9])').test(String(text || '').toLowerCase());
}

// "topup gopay 50rb buat gojek": the purpose decides the category. Returns the one other expense
// category whose alias is in the text, or the top-up category itself.
function vTopupPurpose(cat, categories, text) {
  if (cat.id !== 'e-wallet-top-up') return cat;
  const hits = categories.filter(
    (k) => k.id !== cat.id && vTrue(k.active) && k.type === 'expense' && String(k.aliases || '').split(',').some((a) => vHasWord(text, a)),
  );
  return hits.length === 1 ? hits[0] : cat;
}

function vTime(t, fallback) {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(String(t || '').trim());
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : fallback;
}

// A real calendar date in YYYY-MM-DD ("2026-02-31" is not), else ''
function vDate(d) {
  const s = String(d || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const ms = Date.parse(s + 'T00:00:00Z');
  return !isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === s ? s : '';
}

// "kopi 18rb tgl 20 oktober" came back dated 2023: the model picks a year of its own when the text has none.
// A text message that names no year means the latest such day on or before the message date.
function vYear(date, c) {
  if (!date || c.inbox.kind !== 'text' || /\b(19|20)\d{2}\b|\d[/.-]\d{1,2}[/.-]\d{2}\b|tahun|thn|year/i.test(c.text)) return date;
  const msgDay = c.msg.slice(0, 10);
  if (date > msgDay) return date; // "besok": the future-date reply handles it
  const y = Number(msgDay.slice(0, 4));
  const same = vDate(y + date.slice(4));
  const before = vDate(y - 1 + date.slice(4));
  return (same && same <= msgDay ? same : before) || date;
}

function vNature(type, tag, cat, llm) {
  if (type !== 'expense') return '';
  const pick = [tag, cat && cat.default_nature, llm].map((x) => String(x || '').toLowerCase());
  return pick.find((x) => x === 'need' || x === 'want') || '';
}

// Statement import: the existing entry this row repeats (same account and direction, same amount, date within
// a day), or undefined. Each existing entry answers for one row only, so two equal payments on one day stay two.
function vLogged(row, existing, used) {
  const day = Date.parse(row.txn_date);
  const out = row.type !== 'income';
  const gap = (e) => Math.abs(Date.parse(String(e.txn_date).slice(0, 10)) - day);
  const hits = existing.filter((e) => {
    if (used.has(e) || String(e.status).toLowerCase() === 'void' || Math.round(vNum(e.amount)) !== row.amount || !(gap(e) <= 86400000)) return false;
    const type = String(e.type).toLowerCase();
    if (out) return (type === 'expense' || type === 'transfer') && e.account === row.account;
    return (type === 'income' && e.account === row.account) || (type === 'transfer' && e.to_account === row.account);
  });
  const hit = hits.sort((a, b) => gap(a) - gap(b))[0];
  if (hit) used.add(hit);
  return hit;
}

// Returns {rows, review, split} (main row, then fee row) or {reply}
function vBuildTxn(t, c) {
  const { categories, accounts, text } = c;
  let amount = Math.round(Math.abs(vNum(t.amount)));
  if (!amount || (c.inbox.kind === 'text' && !VALIDATE_AMOUNT_WORDS.test(text))) return { reply: MSG.askAmount(text) };
  const fee = Math.round(Math.abs(vNum(t.fee)));
  const total = vNum(t.receipt && t.receipt.total);
  // a transfer screenshot prints nominal, fee and total: with the total in amount, the fee row would count the fee twice
  if (fee && total && amount === total && amount > fee) amount -= fee;

  const date = vYear(vDate(t.txn_date), c) || c.msg.slice(0, 10);
  if (date > c.today) return { reply: MSG.futureDate() };
  const review = [];
  if (Date.parse(c.msg.slice(0, 10)) - Date.parse(date) > VALIDATE_OLD_DAYS * 86400000) review.push(MSG.reviewOldDate(date));

  const defaultAcc = accounts.find((a) => vTrue(a.is_default)) || accounts[0];
  let acc = t.account ? vFind(accounts, 'account', t.account) : defaultAcc;
  if (!acc) return { reply: MSG.badAccount(t.account, accounts) };
  // the model sometimes ignores the account rule: in a text message the text decides when it names exactly one account, else the default; two or more names are ambiguous, keep the model's pick
  if (c.inbox.kind === 'text' && t.type !== 'transfer') {
    const named = accounts.filter((a) => vNamed(text, a.account));
    if (named.length < 2) acc = named[0] || defaultAcc;
  }
  // "statement bni": the caption names the account the list belongs to
  if (c.statement && t.type !== 'transfer') {
    const named = accounts.filter((a) => vNamed(text, a.account));
    if (named.length === 1) acc = named[0];
  }

  let toName = '';
  let cat = null;
  if (t.type === 'transfer') {
    const to = vFind(accounts, 'account', t.to_account);
    if (!to) return { reply: t.to_account ? MSG.badAccount(t.to_account, accounts) : MSG.needToAccount() };
    if (to.account === acc.account) return { reply: MSG.sameAccount() };
    toName = to.account;
    // a screenshot of a transfer to someone else is an expense: only a caption naming the own account makes it a transfer
    if (c.inbox.kind === 'photo' && !vNamed(text, to.account)) review.push(MSG.reviewTransfer(to.account));
  } else {
    cat = vFind(categories, 'id', t.category_id);
    if (!cat || !vTrue(cat.active)) return { reply: MSG.badCategory(t.category_id) };
    // an income category on an expense row (or the reverse) would corrupt group totals
    if (cat.type !== t.type && cat.type !== 'both') return { reply: MSG.badCategory(t.category_id) };
    cat = vTopupPurpose(cat, categories, text);
  }

  // the opening balance already contains everything up to its date
  for (const a of [acc, vFind(accounts, 'account', toName)]) {
    const opening = a ? vDate(String(a.opening_date || '').slice(0, 10)) : '';
    if (opening && date <= opening) review.push(MSG.reviewOpening(a.account, opening));
  }

  // Receipt split: the caption picked some of the items. Share = picked items plus their part of tax, service
  // and discount: (total - subtotal) x picked / subtotal. The model only marks the items; the sum is done here.
  const items = Array.isArray(t.items) ? t.items : [];
  const mine = items.filter((i) => vTrue(i.selected));
  let split = null;
  const sum = (list) => list.reduce((s, i) => s + Math.abs(vNum(i.price)), 0);
  // Seen live: for "items 2 and 3" the model listed only those two lines, all selected. A caption that picks by
  // number is then still a split when the listed prices stay under the printed subtotal (flagged for review below).
  const onlyPicked = /\b(items?|no|nomor)\.?\s*\d/i.test(text) && sum(mine) < vNum(t.receipt && t.receipt.subtotal) * 0.99;
  if (c.inbox.kind === 'photo' && !c.statement && t.type === 'expense' && text.trim() && mine.length && (mine.length < items.length || onlyPicked)) {
    const listed = sum(items);
    const sub = vNum(t.receipt && t.receipt.subtotal) || listed;
    const bill = total || amount;
    const share = Math.round(sum(mine) + ((bill - sub) * sum(mine)) / sub);
    if (share > 0 && share < bill) {
      if (Math.abs(listed - sub) > sub * 0.01) review.push(MSG.reviewSplit());
      split = { count: mine.length, selected: sum(mine), share, total: bill, names: mine.map((i) => i.name) };
      amount = share;
    }
  }

  const tag = (/#(need|want)\b/i.exec(text) || [])[1];
  const confidence = vNum(t.confidence);
  const row = {
    id: '',
    inbox_update_id: c.inbox.update_id,
    batch_id: 'B' + c.inbox.update_id,
    created_at: c.stamp,
    txn_date: date,
    txn_time: vTime(t.txn_time, c.msg.slice(11, 16)),
    type: t.type,
    amount,
    account: acc.account,
    to_account: toName,
    category_id: cat ? cat.id : '',
    nature: vNature(t.type, tag, cat, t.nature),
    merchant: t.merchant || '',
    note: t.note || '',
    items: split ? split.count : items.length,
    receipt_total: split ? split.total : total > 0 ? total : '',
    irregular: VALIDATE_ANNUAL.test(text) || vTrue(t.irregular),
    source: c.statement ? 'statement' : c.inbox.kind === 'photo' ? 'photo' : 'text',
    recurring_id: '',
    raw_input: text,
    tg_file_id: c.inbox.file_id || '',
    confidence,
    status: confidence < VALIDATE_MIN_CONFIDENCE || review.length ? 'needs_review' : 'ok',
  };

  if (!fee) return { rows: [row], review, split };
  const feeCat = vFind(categories, 'id', 'bank-fee');
  if (!feeCat || !vTrue(feeCat.active)) return { reply: MSG.badCategory('bank-fee') };
  const feeRow = {
    ...row,
    type: 'expense',
    amount: fee,
    to_account: '',
    category_id: feeCat.id,
    nature: vNature('expense', tag, feeCat, null),
    merchant: '',
    note: 'Transfer fee',
    items: 0,
    receipt_total: '',
    irregular: false,
  };
  return { rows: [row, feeRow], review, split };
}

function validateParse({ parsed, inbox, categories, accounts, transactions, nextIdNum, now }) {
  const text = inbox.text || '';
  const missing = parsed.missing || [];
  const txns = parsed.transactions || [];
  // "missing" only matters when nothing was parsed: the model also lists values it did fill in
  // ("amount" next to amount 2000000), so every transaction is checked field by field below instead
  if (!txns.length) {
    const reply = missing.includes('amount') ? MSG.askAmount(text) : MSG.askMissing(missing, parsed.reply_hint);
    return { ok: false, reply };
  }

  const nowJ = vJakarta(now);
  // never fall back to the processing time
  if (!vJakarta(inbox.msg_date)) throw new Error('Inbox.msg_date is not a date: ' + inbox.msg_date);
  const c = {
    categories,
    accounts,
    inbox,
    text,
    today: nowJ.slice(0, 10),
    msg: vJakarta(inbox.msg_date),
    stamp: nowJ + '+07:00',
  };
  // the model sometimes returns the fee twice: in "fee" and again as its own bank-fee expense
  const fees = txns.map((t) => Math.round(Math.abs(vNum(t.fee)))).filter(Boolean);
  const kept = txns.filter((t) => !(t.type === 'expense' && t.category_id === 'bank-fee' && !vNum(t.fee) && fees.includes(Math.round(Math.abs(vNum(t.amount))))));

  // A photo captioned "statement" (or "mutasi"), or one that lists several transactions, is a bank
  // statement: rows that are already in the ledger are skipped instead of written twice
  c.statement = inbox.kind === 'photo' && (/(^|[^a-z])(statement|mutasi)($|[^a-z])/i.test(text) || kept.length > 1);
  const used = new Set();
  const rows = [];
  const review = [];
  const notes = [];
  for (const t of kept) {
    const r = vBuildTxn(t, c);
    if (r.reply) return { ok: false, reply: r.reply };
    if (c.statement && vLogged(r.rows[0], transactions || [], used)) continue;
    rows.push(...r.rows);
    review.push(...r.review);
    if (r.split) notes.push(MSG.split(r.split));
  }
  rows.forEach((r, i) => {
    r.id = 'T' + String(Number(nextIdNum) + i).padStart(4, '0');
  });
  const hint = rows.some((r) => r.status === 'needs_review') ? [MSG.reviewHint()] : [];
  const head = c.statement ? MSG.statement(kept.length, rows, categories) : MSG.saved(rows, categories);
  return { ok: true, rows, reply: [head, ...notes, ...new Set(review), ...hint].join('\n') };
}

if (typeof module !== 'undefined') module.exports = { validateParse };
