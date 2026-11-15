// Standalone script: the Sheet is opened by Script Property SHEET_ID.
// Script Properties: BOT_TOKEN, ALLOWED_CHAT_ID, SHEET_ID. TG_OFFSET and TG_TRIES are written by pollUpdates.

const INBOX_COLS = ['update_id', 'received_at', 'msg_date', 'chat_id', 'kind', 'text', 'file_id', 'status', 'error', 'processed_at'];
const TX_COLS = ['id', 'inbox_update_id', 'batch_id', 'created_at', 'txn_date', 'txn_time', 'type', 'amount', 'account', 'to_account', 'category_id', 'nature', 'merchant', 'note', 'items', 'receipt_total', 'irregular', 'source', 'recurring_id', 'raw_input', 'tg_file_id', 'confidence', 'status'];
const ACCOUNT_COLS = ['account', 'opening_balance', 'opening_date', 'liquid', 'is_default', 'balance'];
const CATEGORY_COLS = ['id', 'group', 'name', 'type', 'default_nature', 'aliases', 'active'];
const TX_TEXT_COLS = ['id', 'inbox_update_id', 'batch_id', 'created_at', 'txn_date', 'txn_time'];

// Jakarta has no DST, so a fixed +07:00 shift is exact.
function jakartaIso(ms) {
  return new Date(ms + 7 * 3600 * 1000).toISOString().slice(0, 19) + '+07:00';
}

// Pure: Telegram update -> Inbox row object, or null for unsupported message types.
function toInboxRow(update, nowDate) {
  const msg = update.message;
  if (!msg) return null;
  let kind, text = '', fileId = '';
  if (msg.photo && msg.photo.length) {
    kind = 'photo';
    text = msg.caption || '';
    fileId = msg.photo.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a)).file_id;
  } else if (typeof msg.text === 'string') {
    kind = msg.text.charAt(0) === '/' ? 'command' : 'text';
    text = msg.text;
  } else {
    return null;
  }
  return {
    update_id: String(update.update_id),
    received_at: jakartaIso(nowDate.getTime()),
    msg_date: jakartaIso(msg.date * 1000),
    chat_id: String(msg.chat.id),
    kind: kind,
    text: text,
    file_id: fileId,
    status: 'new',
    error: '',
    processed_at: '',
  };
}

function prop(name) {
  // trim: a pasted value with a stray space or newline otherwise fails with no visible cause
  return (PropertiesService.getScriptProperties().getProperty(name) || '').trim();
}

// POST to the Bot API. A network error from UrlFetchApp quotes the full URL, token included,
// so it is rethrown with the token masked before anything can log it.
function tgFetch(method, form) {
  try {
    return UrlFetchApp.fetch('https://api.telegram.org/bot' + prop('BOT_TOKEN') + '/' + method, {
      method: 'post',
      payload: form,
      muteHttpExceptions: true,
    });
  } catch (err) {
    throw new Error(String(err && err.message).split(prop('BOT_TOKEN')).join('<BOT_TOKEN>'));
  }
}

function sendMessage(chatId, text) {
  const res = tgFetch('sendMessage', { chat_id: String(chatId), text: text }); // a number would be sent as 7.7772E8
  // Telegram's error body never contains the token, so it is safe to log.
  if (res.getResponseCode() !== 200) console.error('sendMessage failed ' + res.getResponseCode() + ': ' + res.getContentText());
}

const MAX_TRIES = 3; // failed runs on one update before it is skipped with a 🔴 reply

// Telegram Bot API call; throws on a non-ok answer. The error text never contains the token.
function tg(method, payload) {
  const form = {};
  Object.keys(payload).forEach(k => { form[k] = String(payload[k]); }); // UrlFetchApp sends numbers as 1.2E8
  const res = tgFetch(method, form);
  const body = JSON.parse(res.getContentText());
  if (!body.ok) throw new Error(method + ' failed ' + res.getResponseCode() + ': ' + body.description);
  return body.result;
}

// Stores one update in Inbox and acknowledges it. Throws when the Sheet write fails.
function handleUpdate(update, sheet) {
  const msg = update.message;
  if (!msg || !msg.chat || String(msg.chat.id) !== prop('ALLOWED_CHAT_ID')) return; // strangers never get a reply
  const row = toInboxRow(update, new Date());
  if (!row) {
    sendMessage(msg.chat.id, 'Only text and photos are supported.');
    return;
  }
  const last = sheet.getLastRow();
  const from = Math.max(2, last - 499);
  const seen = last >= 2 && sheet.getRange(from, 1, last - from + 1, 1).getValues().some(r => String(r[0]) === row.update_id);
  if (seen) return;
  sheet.appendRow(INBOX_COLS.map(c => row[c]));
  sendMessage(msg.chat.id, '📥 Received');
}

// Time trigger, every minute. Polling instead of a webhook: an Apps Script web app answers
// every POST with a 302 redirect, which Telegram treats as a failed delivery.
function pollUpdates() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // the previous run is still busy
  try {
    const props = PropertiesService.getScriptProperties();
    const offset = Number(props.getProperty('TG_OFFSET') || 0);
    const updates = tg('getUpdates', { offset: offset, timeout: 0, allowed_updates: JSON.stringify(['message']) });
    if (!updates.length) return;
    const sheet = SpreadsheetApp.openById(prop('SHEET_ID')).getSheetByName('Inbox');
    for (const u of updates) {
      try {
        handleUpdate(u, sheet);
      } catch (err) {
        console.error(err);
        const tries = Number(props.getProperty('TG_TRIES') || 0) + 1;
        if (tries < MAX_TRIES) {
          props.setProperty('TG_TRIES', String(tries)); // not confirmed: Telegram gives it again next run
          return;
        }
        // Not stored: say so, otherwise the message is lost silently.
        const chatId = u.message && u.message.chat && u.message.chat.id;
        if (String(chatId) === prop('ALLOWED_CHAT_ID')) sendMessage(chatId, '🔴 Could not save that message. Please send it again.');
      }
      // offset = last update_id + 1 confirms everything up to it to Telegram
      props.setProperties({ TG_OFFSET: String(u.update_id + 1), TG_TRIES: '0' });
    }
  } finally {
    lock.releaseLock();
  }
}

// Run once by hand: removes any webhook (getUpdates answers 409 while one is set) and
// installs the one-minute trigger. Pending messages are kept and picked up by the first run.
function installPolling() {
  const t = prop('BOT_TOKEN'); // Telegram answers 404 for a malformed token, so show its shape, never its value
  console.log('BOT_TOKEN length ' + t.length + ', format ok: ' + /^\d+:[\w-]{30,}$/.test(t) +
    ', ALLOWED_CHAT_ID set: ' + !!prop('ALLOWED_CHAT_ID') + ', SHEET_ID set: ' + !!prop('SHEET_ID'));
  tg('deleteWebhook', { drop_pending_updates: false });
  ScriptApp.getProjectTriggers()
    .filter(tr => tr.getHandlerFunction() === 'pollUpdates')
    .forEach(tr => ScriptApp.deleteTrigger(tr));
  ScriptApp.newTrigger('pollUpdates').timeBased().everyMinutes(1).create();
  pollUpdates();
  console.log('Polling installed.');
}

function colLetter(n) {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function balanceFormula(row) {
  const t = name => 'Transactions!$' + colLetter(TX_COLS.indexOf(name) + 1) + ':$' + colLetter(TX_COLS.indexOf(name) + 1);
  const sum = (accountCol, type) =>
    'SUMIFS(' + t('amount') + ',' + t(accountCol) + ',$A' + row + ',' + t('type') + ',"' + type + '",' + t('status') + ',"<>void")';
  return '=$B' + row + '+' + sum('account', 'income') + '+' + sum('to_account', 'transfer') +
    '-' + sum('account', 'expense') + '-' + sum('account', 'transfer');
}

// Creates a tab with headers if missing; returns the sheet and whether it still has no data rows.
function ensureTab(ss, name, headers) {
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  return { sheet: sheet, empty: sheet.getLastRow() <= 1 };
}

function setup() {
  const ss = SpreadsheetApp.openById(prop('SHEET_ID'));

  const inbox = ensureTab(ss, 'Inbox', INBOX_COLS).sheet;
  inbox.getRange(1, 1, inbox.getMaxRows(), INBOX_COLS.length).setNumberFormat('@'); // no coercion of ids, timestamps, text

  const tx = ensureTab(ss, 'Transactions', TX_COLS).sheet;
  TX_TEXT_COLS.forEach(c => tx.getRange(1, TX_COLS.indexOf(c) + 1, tx.getMaxRows(), 1).setNumberFormat('@'));

  const acc = ensureTab(ss, 'Accounts', ACCOUNT_COLS);
  if (acc.empty) {
    const rows = SEED.accounts.map((a, i) => [a.account, a.opening_balance, a.opening_date, a.liquid, a.is_default, balanceFormula(i + 2)]);
    acc.sheet.getRange(2, 1, rows.length, ACCOUNT_COLS.length).setValues(rows);
  }

  const cat = ensureTab(ss, 'Categories', CATEGORY_COLS);
  if (cat.empty) {
    const rows = SEED.categories.map(c => CATEGORY_COLS.map(k => c[k]));
    cat.sheet.getRange(2, 1, rows.length, CATEGORY_COLS.length).setValues(rows);
  }

  const state = ensureTab(ss, 'State', ['key', 'value']);
  if (state.empty) {
    const rows = Object.keys(SEED.state).map(k => [k, SEED.state[k]]);
    state.sheet.getRange(2, 1, rows.length, 2).setValues(rows);
  }
}
