const REC_WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const REC_MAX_CATCHUP = 12; // more due dates than this in one run is a wrong start_date, not a laptop that was off

function recTrue(x) {
  return x === true || String(x).toUpperCase() === 'TRUE';
}

// A real calendar date in YYYY-MM-DD, else ''
function recDate(d) {
  const s = String(d || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const ms = Date.parse(s + 'T00:00:00Z');
  return !isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === s ? s : '';
}

// Day `d` of month `m` (1-12, may overflow into other years); 29-31 fall back to the last day of a short month
function recDay(y, m, d) {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1, Math.min(d, last))).toISOString().slice(0, 10);
}

// Every due date of a rule that is later than `after` ('' = from start_date) and not later than `until`.
// Returns {dates} or {error}. `limit` stops a rule that would return more than that many dates.
function recDue(rule, after, until, limit) {
  const start = recDate(rule.start_date);
  if (!start) return { error: 'start_date must be a date like 2026-12-05' };
  const end = recDate(rule.end_date);
  if (String(rule.end_date || '').trim() && !end) return { error: 'end_date must be a date like 2026-12-05 or empty' };
  const every = Math.round(Number(rule.interval)) || 1;
  if (every < 1) return { error: 'interval must be 1 or more' };
  const cycle = String(rule.cycle || '').trim().toLowerCase();
  const day = String(rule.day || '').trim().toLowerCase();
  const [sy, sm] = start.split('-').map(Number);

  let at; // k -> date of the k-th cycle
  if (cycle === 'monthly') {
    const d = Number(day);
    if (!(Number.isInteger(d) && d >= 1 && d <= 31)) return { error: 'day must be 1 to 31 for a monthly rule' };
    // the interval counts from the first date on or after start_date
    const skip = recDay(sy, sm, d) < start ? 1 : 0;
    at = (k) => recDay(sy, sm + skip + k * every, d);
  } else if (cycle === 'yearly') {
    const m = /^(\d{1,2})-(\d{1,2})$/.exec(day);
    if (!m || Number(m[1]) < 1 || Number(m[1]) > 12 || Number(m[2]) < 1 || Number(m[2]) > 31) return { error: 'day must be MM-DD for a yearly rule, e.g. 03-15' };
    const skip = recDay(sy, Number(m[1]), Number(m[2])) < start ? 1 : 0;
    at = (k) => recDay(sy + skip + k * every, Number(m[1]), Number(m[2]));
  } else if (cycle === 'weekly') {
    const n = Number(day);
    const wd = Number.isInteger(n) && n >= 1 && n <= 7 ? n % 7 : REC_WEEKDAYS.indexOf(day.slice(0, 3));
    if (wd < 0 || !day) return { error: 'day must be a weekday (mon to sun) for a weekly rule' };
    const startMs = Date.parse(start + 'T00:00:00Z');
    const first = startMs + ((wd - new Date(startMs).getUTCDay() + 7) % 7) * 86400000;
    at = (k) => new Date(first + k * every * 7 * 86400000).toISOString().slice(0, 10);
  } else {
    return { error: 'cycle must be weekly, monthly or yearly' };
  }

  const stop = end && end < until ? end : until;
  const dates = [];
  for (let k = 0; k < 5000; k++) {
    const date = at(k);
    if (date > stop) break;
    if (date < start || (after && date <= after)) continue;
    dates.push(date);
    if (limit && dates.length > limit) break;
  }
  return { dates };
}

// What is wrong with an auto rule's entry, or ''
function recCheck(rule, type, accounts, categories) {
  const acc = (name) => accounts.find((a) => String(a.account).trim().toLowerCase() === String(name || '').trim().toLowerCase());
  if (!['expense', 'income', 'transfer'].includes(type)) return 'type must be expense, income or transfer';
  if (!(Math.round(Number(rule.amount)) > 0)) return 'an auto rule needs an amount';
  if (!acc(rule.account)) return `unknown account "${rule.account || ''}"`;
  if (type === 'transfer') {
    if (!acc(rule.to_account)) return `unknown to_account "${rule.to_account || ''}"`;
    if (acc(rule.to_account) === acc(rule.account)) return 'a transfer needs two different accounts';
    return '';
  }
  const cat = categories.find((c) => c.id === String(rule.category_id || '').trim());
  if (!cat || !recTrue(cat.active)) return `category "${rule.category_id || ''}" is missing or inactive`;
  if (cat.type !== type && cat.type !== 'both') return `category "${cat.id}" is not an ${type} category`;
  return '';
}

function recActive(rules) {
  return (rules || []).filter((r) => String(r.id || '').trim() && recTrue(r.active));
}

// Writes the due entries of auto rules, lists the due reminders, and returns the new last_run of every
// rule that was handled. ruleUpdates must be saved only after appendRows are in the Sheet.
function runRecurring({ rules, transactions, accounts, categories, nextIdNum, inbox, now }) {
  const nowJ = new Date(Date.parse(now) + 7 * 3600000).toISOString();
  const today = nowJ.slice(0, 10);
  const lines = [];
  const appendRows = [];
  const ruleUpdates = [];
  for (const rule of recActive(rules)) {
    const id = String(rule.id).trim();
    const mode = String(rule.mode || '').trim().toLowerCase();
    const type = String(rule.type || '').trim().toLowerCase();
    const due = recDue(rule, recDate(rule.last_run), today, REC_MAX_CATCHUP);
    let bad = due.error || '';
    if (!bad && !due.dates.length) continue;
    if (!bad && mode !== 'auto' && mode !== 'reminder') bad = 'mode must be auto or reminder';
    if (!bad && due.dates.length > REC_MAX_CATCHUP) bad = `more than ${REC_MAX_CATCHUP} dates are due; check start_date and last_run`;
    if (!bad && mode === 'auto') bad = recCheck(rule, type, accounts, categories);
    if (bad) {
      lines.push(MSG.recurringBad(rule.name || id, bad));
      continue;
    }
    for (const date of due.dates) {
      if (mode === 'reminder') {
        lines.push(MSG.recurringReminder(rule, date, today));
        continue;
      }
      // a run that stopped after the write but before last_run was saved must not write the date twice
      if (transactions.some((t) => String(t.recurring_id || '').trim() === id && String(t.txn_date).slice(0, 10) === date)) continue;
      const cat = categories.find((c) => c.id === String(rule.category_id || '').trim());
      const nature = [rule.nature, cat && cat.default_nature].map((x) => String(x || '').toLowerCase()).find((x) => x === 'need' || x === 'want');
      const row = {
        id: 'T' + String(Number(nextIdNum) + appendRows.length).padStart(4, '0'),
        inbox_update_id: inbox.update_id,
        batch_id: 'B' + inbox.update_id,
        created_at: nowJ.slice(0, 19) + '+07:00',
        txn_date: date,
        txn_time: '',
        type,
        amount: Math.round(Number(rule.amount)),
        account: accounts.find((a) => String(a.account).trim().toLowerCase() === String(rule.account).trim().toLowerCase()).account,
        to_account: type === 'transfer' ? accounts.find((a) => String(a.account).trim().toLowerCase() === String(rule.to_account).trim().toLowerCase()).account : '',
        category_id: type === 'transfer' ? '' : cat.id,
        nature: type === 'expense' ? nature || '' : '',
        merchant: '',
        note: rule.name || id,
        items: '',
        receipt_total: '',
        irregular: false,
        source: 'recurring',
        recurring_id: id,
        raw_input: inbox.text || '',
        tg_file_id: '',
        confidence: 1,
        status: 'ok',
      };
      appendRows.push(row);
      lines.push(MSG.recurringLogged(row));
    }
    ruleUpdates.push({ id, last_run: due.dates[due.dates.length - 1] });
  }
  return { reply: lines.join('\n') || MSG.recurringNothing(), appendRows, voidIds: [], ruleUpdates };
}

// True when runRecurring would write, remind or complain: the daily trigger only queues a run then
function recurringPending(rules, now) {
  const today = new Date(Date.parse(now) + 7 * 3600000).toISOString().slice(0, 10);
  return recActive(rules).some((r) => {
    const due = recDue(r, recDate(r.last_run), today, 1);
    return Boolean(due.error) || due.dates.length > 0;
  });
}

// /recurring: active rules with the next date each one is due
function listRecurring(rules, now) {
  const today = new Date(Date.parse(now) + 7 * 3600000).toISOString().slice(0, 10);
  const items = recActive(rules).map((rule) => {
    const due = recDue(rule, recDate(rule.last_run), '9999-12-31', 1);
    return { rule, error: due.error || '', next: due.error ? '' : due.dates[0] || '' };
  });
  return { reply: MSG.recurringList(items, today), appendRows: [], voidIds: [] };
}

if (typeof module !== 'undefined') module.exports = { runRecurring, recurringPending, listRecurring, recDue };
