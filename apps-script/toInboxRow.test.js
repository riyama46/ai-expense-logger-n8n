const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ PropertiesService: {}, UrlFetchApp: {}, LockService: {}, SpreadsheetApp: {}, ContentService: {}, console });
vm.runInContext(fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8'), ctx);
const toInboxRow = (u, now) => JSON.parse(JSON.stringify(ctx.toInboxRow(u, now)));

const now = new Date(Date.UTC(2026, 10, 1, 1, 10, 5)); // 08:10:05 Jakarta
const date = Date.UTC(2026, 10, 1, 1, 10, 0) / 1000;
const upd = message => ({ update_id: 777, message: Object.assign({ date, chat: { id: 42 } }, message) });
const base = { update_id: '777', received_at: '2026-11-01T08:10:05+07:00', msg_date: '2026-11-01T08:10:00+07:00', chat_id: '42', status: 'new', error: '', processed_at: '' };

test('plain text', () => {
  assert.deepStrictEqual(toInboxRow(upd({ text: 'makan padang 25rb' }), now),
    { ...base, kind: 'text', text: 'makan padang 25rb', file_id: '' });
});

test('command', () => {
  const r = toInboxRow(upd({ text: '/balance' }), now);
  assert.strictEqual(r.kind, 'command');
  assert.strictEqual(r.text, '/balance');
});

test('photo with caption picks the largest size', () => {
  const photo = [
    { file_id: 'small', width: 90, height: 60 },
    { file_id: 'big', width: 1280, height: 960 },
    { file_id: 'mid', width: 320, height: 240 },
  ];
  const r = toInboxRow(upd({ photo, caption: 'lunch' }), now);
  assert.strictEqual(r.kind, 'photo');
  assert.strictEqual(r.text, 'lunch');
  assert.strictEqual(r.file_id, 'big');
});

test('photo without caption', () => {
  const r = toInboxRow(upd({ photo: [{ file_id: 'a', width: 10, height: 10 }] }), now);
  assert.strictEqual(r.kind, 'photo');
  assert.strictEqual(r.text, '');
  assert.strictEqual(r.file_id, 'a');
});

test('unsupported type returns null', () => {
  assert.strictEqual(ctx.toInboxRow(upd({ voice: { file_id: 'v', duration: 3 } }), now), null);
});

test('timestamp conversion, including across midnight', () => {
  const late = { update_id: 1, message: { date: Date.UTC(2026, 10, 1, 18, 0, 0) / 1000, chat: { id: 1 }, text: 'x' } };
  assert.strictEqual(toInboxRow(late, now).msg_date, '2026-11-02T01:00:00+07:00');
  assert.strictEqual(toInboxRow(upd({ text: 'x' }), now).received_at, '2026-11-01T08:10:05+07:00');
});
