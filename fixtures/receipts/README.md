Drop 10 real receipt photos here: cash, QRIS, debit, one with tax and service, and one for the later split feature.
This folder is git-ignored (see .gitignore) because receipts are private; only this README is tracked.
Each photo needs its expected row noted in a local `expected.local.json` (also git-ignored), keyed by file name.
Shape: `{ "bakmi-001.jpg": { "caption": "", "rows": [{ "type": "expense", "amount": 87500, "account": "Cash", "category_id": "food", "txn_date": "2026-11-02" }] } }`
There is no photo runner yet; `fixtures/run.js` covers text messages only.
