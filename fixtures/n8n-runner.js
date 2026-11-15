// Builds an n8n workflow that runs fixtures/text.json against the real model through the
// "OpenAI" credential stored in n8n, so the API key never has to be in a terminal.
//
//   node fixtures/n8n-runner.js <out dir> <model id>
//   (stop n8n) npx n8n@2.45.5 import:workflow --input=<out dir>/fixtures-runner.json
//   npx n8n@2.45.5 execute --id=ExpFixturesRun01 --rawOutput > <out dir>/result.json
//   node fixtures/n8n-runner.js --report <out dir>/result.json
//
// Delete the "Fixtures runner" workflow in n8n when it is no longer needed.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const lib = (file) =>
  fs
    .readFileSync(path.join(root, 'n8n', 'code', file), 'utf8')
    .replace(/^if \(typeof module !== 'undefined'\).*$/m, '')
    .trim();

if (process.argv[2] === '--report') {
  const raw = fs.readFileSync(process.argv[3], 'utf8');
  const out = JSON.parse(raw.slice(raw.indexOf('{')));
  const find = (o) => {
    if (!o || typeof o !== 'object') return null;
    if (Array.isArray(o.lines) && typeof o.passed === 'number') return o;
    for (const v of Object.values(o)) {
      const hit = find(v);
      if (hit) return hit;
    }
    return null;
  };
  const res = find(out);
  if (!res) throw new Error('No fixture result in ' + process.argv[3]);
  console.log(res.lines.join('\n'));
  console.log(`${res.passed}/${res.total} passed`);
  process.exit(res.passed === res.total ? 0 : 1);
}

const [outDir, model] = process.argv.slice(2);
if (!outDir || !model) {
  console.error('Usage: node fixtures/n8n-runner.js <out dir> <model id>');
  process.exit(1);
}
const { categories, accounts } = require('../data/seed.json');
const fixtures = require('./text.json');
const compare = require('./run.js').compare;
const data = `const DATA = ${JSON.stringify({ categories, accounts, fixtures, model })};`;

const requests = [
  lib('prompt.js'),
  data,
  `return DATA.fixtures.map((f) => ({ json: { body: buildLlmRequest({ kind: 'text', text: f.text, msgDate: f.msg_date, categories: DATA.categories, accounts: DATA.accounts, model: DATA.model }) } }));`,
].join('\n');

const report = [
  lib('messages.js'),
  lib('validate.js'),
  data,
  compare.toString(),
  `const lines = [];
let passed = 0;
$input.all().forEach((item, i) => {
  const f = DATA.fixtures[i];
  let diffs;
  try {
    const parsed = JSON.parse(item.json.choices[0].message.content);
    const now = new Date(Date.parse(f.msg_date) + 60000).toISOString();
    const inbox = { update_id: 1, msg_date: f.msg_date, kind: 'text', text: f.text, file_id: '' };
    diffs = compare(f.expect, validateParse({ parsed, inbox, categories: DATA.categories, accounts: DATA.accounts, nextIdNum: 1, now }));
  } catch (e) {
    diffs = ['error: ' + e.message + ' ' + JSON.stringify(item.json.error || '').slice(0, 300)];
  }
  if (!diffs.length) passed++;
  lines.push((diffs.length ? 'FAIL  ' : 'PASS  ') + f.name + (diffs.length ? ' [' + f.text + ']\\n      ' + diffs.join('\\n      ') : ''));
});
return [{ json: { passed, total: DATA.fixtures.length, lines } }];`,
].join('\n');

const node = (name, type, typeVersion, x, extra) => ({ id: name.toLowerCase().replace(/\W+/g, '-'), name, type, typeVersion, position: [x, 0], ...extra });
const wf = {
  id: 'ExpFixturesRun01',
  name: 'Fixtures runner',
  active: false,
  settings: { executionOrder: 'v1', timezone: 'Asia/Jakarta' },
  nodes: [
    node('Start', 'n8n-nodes-base.manualTrigger', 1, 0, { parameters: {} }),
    node('Requests', 'n8n-nodes-base.code', 2, 220, { parameters: { jsCode: requests } }),
    node('LLM', 'n8n-nodes-base.httpRequest', 4.5, 440, {
      parameters: {
        method: 'POST',
        url: 'https://api.openai.com/v1/chat/completions',
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'openAiApi',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ $json.body }}',
        options: { timeout: 45000 },
      },
      credentials: { openAiApi: { id: 'PLACEHOLDER', name: 'OpenAI' } },
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 5000,
      onError: 'continueRegularOutput',
    }),
    node('Report', 'n8n-nodes-base.code', 2, 660, { parameters: { jsCode: report } }),
  ],
  connections: {
    Start: { main: [[{ node: 'Requests', type: 'main', index: 0 }]] },
    Requests: { main: [[{ node: 'LLM', type: 'main', index: 0 }]] },
    LLM: { main: [[{ node: 'Report', type: 'main', index: 0 }]] },
  },
};
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'fixtures-runner.json'), JSON.stringify(wf, null, 2) + '\n');
console.log('Wrote ' + path.join(outDir, 'fixtures-runner.json'));
