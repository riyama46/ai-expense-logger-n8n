const PROMPT_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const PROMPT_RULES = `You turn a personal finance message (Indonesian or English) or a receipt photo into structured transactions for one user in Jakarta. Currency is IDR. Return JSON only, matching the schema.

Amounts: whole rupiah, always positive; direction comes from "type". "25rb" or "25k" = 25000, "1,5jt" = 1500000, "ceban" = 10000, "goceng" = 5000.
Dates and times: first match wins: (a) a date or time written in the message ("kemarin", "tadi pagi", "tgl 28 jam 8", "28/10 19.30"), resolved against the message time below; (b) the date and time printed on the receipt or statement; (c) otherwise leave txn_date and txn_time null. Use YYYY-MM-DD and 24h HH:MM. Never use today's processing time. A date without a month or year ("tgl 28") means the most recent such date on or before the message date, never a future one.
Account: default account unless the message names one. "cash" or "tunai" means Cash. A named account wins.
Types: "expense" is money spent, "income" is money received, "transfer" moves money between two own accounts (account = from, to_account = to).
Transfer fee: if a fee is stated or visible, put it in "fee" (whole rupiah) and keep it out of "amount": amount is the money sent, without the fee. Do not add a separate transaction for the fee. Never guess a fee; use 0 when none.
ATM withdrawal is a transfer from the bank account to Cash. Investing (e.g. buying VOO) is a transfer to Investment, never an expense.
E-wallet top-up (GoPay, OVO, Dana...) is an expense. When the message says what the top-up is for ("buat gojek", "untuk makan"), the category is that purpose and not e-wallet top-up: "topup gopay 50rb buat gojek" is the transport category. Use the e-wallet top-up category only when no purpose is given. There are no e-wallet accounts.
Category: choose only from the list, using aliases as hints. For transfers set category_id null. For income use an income category; freelance income is the IDR amount that actually reached the bank, category freelance.
Nature: every expense gets "need" or "want", never null. "#need" or "#want" in the text decides it; otherwise use the category default when it has one; otherwise decide yourself. Null for income and transfers.
Irregular: true when the text has "#irregular" or the expense is annual by nature (pajak motor, STNK, yearly service, annual fee, insurance premium paid yearly); otherwise false.
merchant: shop or payee when known, else null. note: 1-3 words describing the purchase, else null.
confidence: 0 to 1, how sure you are about the whole transaction.
Never invent an amount: when the message states no amount, set amount to 0 and add "amount" to "missing". Leave "missing" empty when the amount is stated. Use reply_hint for one short note about anything ambiguous, else null.
One transaction per payment. A receipt photo is one transaction.`;

const PROMPT_PHOTO_RULES = `Photo rules: read the receipt or screenshot. Fill "items" with every line item (no from 1, name, price, selected true), and "receipt" with subtotal, tax, service, discount and total (0 when absent). Without a caption the user paid the full total: amount = total. Use the printed payment method for the account: CASH or TUNAI is Cash; DEBIT or QRIS with a bank name is that bank; unknown is the default account. Use the date and time printed on the receipt. Bank or e-wallet screenshots (transfer, QRIS, payment success): money sent to another person or a merchant is an expense from the bank whose app is shown, merchant = the recipient name, category from the caption or remarks, otherwise the others category; it is a "transfer" only when the caption names one of the user's own accounts as the destination. "IDR 100,000.00" and "Rp 100.000,00" both mean 100000: the two digits after the last separator are cents, drop them. An admin fee shown on the screenshot goes in "fee", and amount is the nominal without it. A screenshot of a transaction list (account activity or history: several rows, each with its own date, name and amount) is one transaction per row, top to bottom: never skip, merge or reorder rows, and copy every name and amount exactly as printed. Skip only rows marked failed, pending or cancelled. Money sent or paid is an expense, money received is income. A row that sends money to a person ("Transfer to BCA Account" under a name) is an expense with merchant = that name, never a transfer to Cash; a person's name alone says nothing about the category, so use the others category for it. For these rows set items to [] and receipt to null, and txn_time to null unless a time is printed on the row (the clock in the phone status bar is not a transaction time). Never guess a row: when a row is too small or blurred to read, leave it out and say in reply_hint how many rows were left out. When a printed date has no legible year, use the year of the message time. For text messages set items to [] and receipt to null.`;

function promptTrue(x) {
  return x === true || String(x).toUpperCase() === 'TRUE';
}

function promptJakarta(iso) {
  const ms = Date.parse(iso);
  if (isNaN(ms)) return String(iso);
  const d = new Date(ms + 7 * 3600000);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} (${PROMPT_WEEKDAYS[d.getUTCDay()]})`;
}

function promptObj(props) {
  return { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false };
}

function promptSchema(catIds, accNames) {
  const str = { type: ['string', 'null'] };
  const int = { type: 'integer' };
  const txn = promptObj({
    type: { type: 'string', enum: ['expense', 'income', 'transfer'] },
    amount: int,
    account: { type: 'string', enum: accNames },
    to_account: { type: ['string', 'null'], enum: [...accNames, null] },
    category_id: { type: ['string', 'null'], enum: [...catIds, null] },
    nature: { type: ['string', 'null'], enum: ['need', 'want', null] },
    merchant: str,
    note: str,
    txn_date: str,
    txn_time: str,
    fee: int,
    irregular: { type: 'boolean' },
    items: {
      type: 'array',
      items: promptObj({ no: int, name: { type: 'string' }, price: int, selected: { type: 'boolean' } }),
    },
    receipt: {
      anyOf: [promptObj({ subtotal: int, tax: int, service: int, discount: int, total: int }), { type: 'null' }],
    },
    confidence: { type: 'number' },
  });
  return promptObj({
    transactions: { type: 'array', items: txn },
    missing: { type: 'array', items: { type: 'string' } },
    reply_hint: str,
  });
}

function buildLlmRequest({ kind, text, imageDataUrl, msgDate, categories, accounts, model }) {
  const cats = categories.filter((c) => promptTrue(c.active));
  const catLines = cats.map(
    (c) => `${c.id} | ${c.group} | ${c.name} | ${c.type} | default_nature: ${c.default_nature || '-'} | aliases: ${c.aliases || '-'}`,
  );
  const accLines = accounts.map((a) => a.account + (promptTrue(a.is_default) ? ' (default)' : ''));
  const photo = kind === 'photo';
  const system = [
    PROMPT_RULES,
    photo ? PROMPT_PHOTO_RULES : '',
    `Message time (Asia/Jakarta): ${promptJakarta(msgDate)}`,
    `Categories (id | group | name | type | default nature | aliases):\n${catLines.join('\n')}`,
    `Accounts:\n${accLines.join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const content = photo
    ? [
        { type: 'text', text: text || '(no caption)' },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ]
    : text;
  return {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'parsed_entry',
        strict: true,
        schema: promptSchema(
          cats.map((c) => c.id),
          accounts.map((a) => a.account),
        ),
      },
    },
  };
}

if (typeof module !== 'undefined') module.exports = { buildLlmRequest };
