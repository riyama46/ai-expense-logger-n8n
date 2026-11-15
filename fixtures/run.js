Object.assign(globalThis, require('../n8n/code/messages.js'));
const { buildLlmRequest } = require('../n8n/code/prompt.js');
const { validateParse } = require('../n8n/code/validate.js');

// Returns a list of differences (empty = pass). A field value that is an array means any-of.
function compare(expect, res) {
  if (expect.ask) return res.ok ? [`expected a question, got ${res.rows.length} row(s)`] : [];
  if (!res.ok) return [`expected rows, got a question: ${res.reply}`];
  if (res.rows.length !== expect.rows.length) return [`rows: expected ${expect.rows.length}, got ${res.rows.length}`];
  const diffs = [];
  expect.rows.forEach((want, i) => {
    for (const [k, v] of Object.entries(want)) {
      const got = res.rows[i][k];
      if (!(Array.isArray(v) ? v.includes(got) : v === got)) diffs.push(`row${i + 1}.${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(got)}`);
    }
  });
  return diffs;
}

async function main() {
  const { OPENAI_API_KEY: key, LLM_MODEL: model } = process.env;
  if (!key || !model) {
    console.error('Set OPENAI_API_KEY and LLM_MODEL before running the fixtures.');
    process.exit(1);
  }
  const { categories, accounts } = require('../data/seed.json');
  const only = process.argv[2];
  const fixtures = require('./text.json').filter((f) => !only || f.name.includes(only));
  let failed = 0;
  for (const f of fixtures) {
    let diffs;
    try {
      const body = buildLlmRequest({ kind: 'text', text: f.text, msgDate: f.msg_date, categories, accounts, model });
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} ${await resp.text()}`);
      const parsed = JSON.parse((await resp.json()).choices[0].message.content);
      const now = new Date(Date.parse(f.msg_date) + 60000).toISOString();
      const inbox = { update_id: 1, msg_date: f.msg_date, kind: 'text', text: f.text, file_id: '' };
      diffs = compare(f.expect, validateParse({ parsed, inbox, categories, accounts, nextIdNum: 1, now }));
    } catch (e) {
      diffs = [`error: ${e.message}`];
    }
    if (diffs.length) failed++;
    console.log(`${diffs.length ? 'FAIL' : 'PASS'}  ${f.name}${diffs.length ? '\n      ' + diffs.join('\n      ') : ''}`);
  }
  console.log(`${fixtures.length - failed}/${fixtures.length} passed`);
  process.exit(failed ? 1 : 0);
}

if (require.main === module) main();
module.exports = { compare };
