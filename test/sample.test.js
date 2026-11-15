// Shared sample data (required by the other test files) plus a sanity test of it.
const test = require('node:test');
const assert = require('node:assert');

const CATEGORIES = [
  { id: 'food', group: 'Living', name: 'Food', type: 'expense', default_nature: '', aliases: 'makan, kopi', active: true },
  { id: 'transport-ojol-bensin', group: 'Transport', name: 'Transport / ojol / bensin', type: 'expense', default_nature: 'need', aliases: 'gojek, grab, bensin', active: 'TRUE' },
  { id: 'game', group: 'Lifestyle', name: 'Game', type: 'expense', default_nature: 'want', aliases: '', active: true },
  { id: 'bank-fee', group: 'System', name: 'Bank fee', type: 'expense', default_nature: 'need', aliases: 'admin', active: true },
  { id: 'unrecorded-cash', group: 'System', name: 'Unrecorded cash', type: 'both', default_nature: '', aliases: '', active: true },
  { id: 'e-wallet-top-up', group: 'Other', name: 'E-wallet top-up', type: 'expense', default_nature: '', aliases: 'topup', active: true },
  { id: 'income-salary', group: 'Income', name: 'Salary', type: 'income', default_nature: '', aliases: 'gaji', active: true },
  { id: 'income-freelance', group: 'Income', name: 'Freelance', type: 'income', default_nature: '', aliases: 'upwork', active: true },
  { id: 'income-stock', group: 'Income', name: 'Stock', type: 'income', default_nature: '', aliases: '', active: false },
];

const ACCOUNTS = [
  { account: 'Cash', opening_balance: 0, liquid: true, is_default: '', balance: 100000 },
  { account: 'BCA', opening_balance: 0, liquid: 'TRUE', is_default: 'TRUE', balance: '1250000' },
  { account: 'BNI', opening_balance: 0, liquid: true, is_default: '', balance: 500000 },
  { account: 'Koperasi', opening_balance: 0, liquid: true, is_default: '', balance: 2000000 },
  { account: 'Investment', opening_balance: 0, liquid: false, is_default: '', balance: 9000000 },
];

// Registered only when run directly, so requiring this file from other tests adds nothing.
if (require.main === module) test('sample ids follow the slug rule', () => {
  for (const c of CATEGORIES) assert.match(c.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.equal(ACCOUNTS.filter((a) => a.is_default === 'TRUE').length, 1);
});

// The start of a JPEG as base64: SOI, an APP0 segment, then the frame header with the size
function jpeg(width, height, sof = 0xc0) {
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14)]);
  const frame = Buffer.from([0xff, sof, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, frame, Buffer.alloc(8)]).toString('base64');
}

module.exports = { CATEGORIES, ACCOUNTS, jpeg };
