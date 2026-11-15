const MSG_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtRp(n) {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? '-' : '') + 'Rp' + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function fmtDate(d) {
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
  return MSG_MONTHS[m - 1] ? `${day} ${MSG_MONTHS[m - 1]} ${y}` : String(d);
}

// '2026-11' -> 'Nov 2026'
function msgMonth(ym) {
  const [y, m] = String(ym).split('-').map(Number);
  return `${MSG_MONTHS[m - 1]} ${y}`;
}

function msgPlural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function msgLine(r, names) {
  const review = r.status === 'needs_review';
  const parts = [fmtRp(r.amount)];
  if (r.type === 'transfer') parts.push(`${r.account} → ${r.to_account}`);
  else parts.push(names[r.category_id] || r.category_id, r.account);
  const label = r.note || r.merchant;
  if (label) parts.push(`"${label}"`);
  if (r.nature) parts.push(r.nature);
  return `${review ? '⚠️' : '✅'} ${parts.join(' · ')}  (#${r.id})${review ? ' · needs review' : ''}`;
}

// One entry on one line for /review and /last: mark, id, date, amount, where, label
function msgBrief(r) {
  const mark = r.status === 'needs_review' ? '⚠️' : '✅';
  const where = r.type === 'transfer' ? `${r.account} → ${r.to_account}` : `${r.category_id} · ${r.account}`;
  const label = r.merchant || r.note;
  return `${mark} #${r.id} · ${fmtDate(r.txn_date)} · ${fmtRp(r.amount)} · ${where}${label ? ` · "${label}"` : ''}`;
}

const MSG_LIST_MAX = 30;

function msgList(rows) {
  const lines = rows.slice(0, MSG_LIST_MAX).map(msgBrief);
  if (rows.length > MSG_LIST_MAX) lines.push(`… and ${rows.length - MSG_LIST_MAX} more`);
  return lines;
}

const MSG = {
  // rows: Transactions row objects of one batch; categories: Categories rows (for names)
  saved(rows, categories) {
    const names = {};
    for (const c of categories || []) names[c.id] = c.name;
    return rows.map((r, i) => msgLine(r, names) + (i === rows.length - 1 ? ' · /undo' : '')).join('\n');
  },
  askAmount(text) {
    const eg = text ? `${text} 18rb` : '18rb';
    return `❓ How much was it? Reply with the amount, e.g. "${eg}".`;
  },
  askMissing(missing, hint) {
    const what = (missing || []).join(', ');
    return `❓ I need a bit more info${what ? `: ${what}` : ''}.${hint ? ` ${hint}` : ''} Please send it again with the details.`;
  },
  reviewOldDate(date) {
    return `Check the date: ${fmtDate(date)} is more than two months back.`;
  },
  reviewOpening(account, openingDate) {
    return `Check: dated on or before the ${account} opening balance (${fmtDate(openingDate)}), so it may be counted twice. /undo if so.`;
  },
  reviewTransfer(account) {
    return `Check: saved as a transfer to your own ${account}. If you paid someone else, /undo and send it again with a caption, e.g. "bayar utang 100rb".`;
  },
  photoTooLong() {
    return '❓ This screenshot is too long to read: Telegram shrinks it and the text gets too small. Nothing was saved. Send shorter screenshots instead, about two screens each.';
  },
  futureDate() {
    return '❓ That date is in the future. For upcoming payments, add a rule in the Recurring tab.';
  },
  badAccount(name, accounts) {
    const list = (accounts || []).map((a) => a.account).join(', ');
    return `❓ I don't know the account "${name}". Accounts: ${list}.`;
  },
  badCategory(id) {
    return `❓ The category "${id}" is missing or inactive. Check the Categories tab, then send it again.`;
  },
  needToAccount() {
    return '❓ Which account did the money go to? Send it again with the destination account.';
  },
  sameAccount() {
    return '❓ A transfer needs two different accounts. Send it again with the right ones.';
  },
  error(text, reason) {
    const what = text ? `"${text}"` : 'your message';
    return `🔴 Couldn't process ${what} (${reason || 'the AI service did not respond'}). Please send it again.`;
  },
  pending(n) {
    return `📥 Processing ${msgPlural(n, 'pending message', 'pending messages')}`;
  },
  reviewHint() {
    return 'All correct? Send /ok. Otherwise /review shows how to fix them.';
  },
  reviewList(rows) {
    return [
      `⚠️ ${msgPlural(rows.length, 'entry needs', 'entries need')} review`,
      ...msgList(rows),
      'All correct: /ok · some correct: /ok 16 25 · wrong: /undo 25, then send that one again as text.',
    ].join('\n');
  },
  reviewNone() {
    return 'Nothing needs review.';
  },
  confirmed(ids) {
    return `✅ Confirmed ${msgPlural(ids.length, 'entry', 'entries')} (${ids.map((i) => '#' + i).join(', ')}).`;
  },
  // what: 'void' for /undo, 'confirm' for /ok
  badIds(tokens, what) {
    const why = what === 'confirm' ? 'not found or not waiting for review' : 'not found or already void';
    return `❓ Nothing changed: ${tokens.join(', ')} ${why}. Send /${what === 'confirm' ? 'review' : 'last'} to see the ids.`;
  },
  last(rows) {
    return rows.length ? ['Latest entries', ...msgList(rows)].join('\n') : 'No entries yet.';
  },
  voided(ids) {
    return `↩️ Voided ${msgPlural(ids.length, 'entry', 'entries')} (${ids.map((i) => '#' + i).join(', ')}).`;
  },
  nothingToVoid() {
    return 'Nothing to void.';
  },
  // accounts: [{account, balance}], liquidTotal: number
  balance(accounts, liquidTotal) {
    const lines = accounts.map((a) => `${a.account} · ${fmtRp(a.balance)}`);
    return ['Balance', ...lines, `Liquid total · ${fmtRp(liquidTotal)}`].join('\n');
  },
  summaryUsage() {
    return '❓ Which month? Send "/summary" for this month or e.g. "/summary 2026-10".';
  },
  summaryEmpty(month) {
    return `No entries in ${msgMonth(month)}.`;
  },
  // d: the totals built by cSummary (commands.js)
  summary(d) {
    const pct = (n) => `${d.expense ? Math.round((n / d.expense) * 100) : 0}%`;
    const pairs = (list) => list.map((x) => `${x.name} ${fmtRp(x.amount)}`).join(' · ');
    const out = [
      `Summary · ${msgMonth(d.month)}${d.to ? ` (to ${fmtDate(d.to)})` : ''}`,
      `Income · ${fmtRp(d.income)}`,
      `Expense · ${fmtRp(d.expense)}`,
      `Net · ${fmtRp(d.income - d.expense)}`,
    ];
    if (d.expense) {
      out.push('', 'Expense by group');
      for (const g of d.groups) {
        out.push(`${g.name} · ${fmtRp(g.amount)} · ${pct(g.amount)}`);
        for (const s of g.subs) out.push(`   ${s.name} · ${fmtRp(s.amount)}`);
      }
      const unset = d.expense - d.need - d.want;
      out.push('', 'Need vs want', `Need · ${fmtRp(d.need)} · ${pct(d.need)}`, `Want · ${fmtRp(d.want)} · ${pct(d.want)}`);
      if (unset) out.push(`Not set · ${fmtRp(unset)} · ${pct(unset)}`);
      if (d.want) {
        out.push(`Top want · ${pairs(d.topWant)}`);
        out.push(`Want by day · weekday ${fmtRp(d.wantWeekday)} · weekend ${fmtRp(d.wantWeekend)}`);
        if (d.wantTimes.length) out.push(`Want by time · ${pairs(d.wantTimes)}`);
      }
    }
    if (d.irregular.length || d.irregularAvg) {
      out.push('', 'Irregular');
      for (const r of d.irregular) out.push(`${fmtDate(r.txn_date)} · ${fmtRp(r.amount)} · ${r.name}${r.label ? ` · "${r.label}"` : ''}`);
      out.push(`12-month average · ${fmtRp(d.irregularAvg)} a month`);
    }
    out.push('', `Freelance income · ${fmtRp(d.freelance)}`);
    if (d.review) out.push(`⚠️ ${msgPlural(d.review, 'entry needs', 'entries need')} review · /review`);
    out.push(`Liquid total · ${fmtRp(d.liquid)}`);
    const span = `the last ${msgPlural(d.fullMonths, 'full month', 'full months')}`;
    if (!d.fullMonths) out.push('Runway · not enough history yet (needs one full month of entries)');
    else if (!d.needAvg) out.push(`Runway · no "need" spending in ${span}`);
    else out.push(`Runway · ${(d.liquid / d.needAvg).toFixed(1)} months ("need" spending ${fmtRp(d.needAvg)} a month over ${span})`);
    return out.join('\n');
  },
  cashAdjusted(real, diff, id) {
    return `✅ Cash set to ${fmtRp(real)}. Logged ${fmtRp(Math.abs(diff))} as unrecorded cash (#${id}) · /undo`;
  },
  cashMatches(real) {
    return `Cash matches at ${fmtRp(real)}. Nothing to log.`;
  },
  cashUsage() {
    return '❓ How much cash do you have? Send e.g. "/cash 150000".';
  },
  help() {
    return [
      'Send a message or a receipt photo to log an entry, e.g. "makan padang 25rb".',
      '/undo · void the last entry, or one by id, e.g. /undo or /undo 25',
      '/last · show the latest entries, e.g. /last or /last 10',
      '/review · list entries that need review, e.g. /review',
      '/ok · confirm entries that need review, e.g. /ok or /ok 16 25',
      '/summary · show a month in numbers, e.g. /summary or /summary 2026-10',
      '/balance · show account balances, e.g. /balance',
      '/cash <amount> · set real cash, e.g. /cash 150000',
      '/help · show this list, e.g. /help',
    ].join('\n');
  },
  unknownCommand() {
    return "Unknown command. Send /help to see what's available.";
  },
  nudge(n) {
    return `${msgPlural(n, 'entry', 'entries')} today. Anything missing?`;
  },
};

if (typeof module !== 'undefined') module.exports = { MSG, fmtRp, fmtDate };
