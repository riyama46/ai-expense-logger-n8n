// Templates (n8n/workflows/*.json) -> importable workflows (n8n/dist/*.json).
// In a Code node, jsCode may be a string or an array of lines; each "//@include <file>" line
// is replaced by n8n/code/<file> without its CommonJS export line.
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const lib = (file) =>
  fs
    .readFileSync(path.join(dir, 'code', file), 'utf8')
    .replace(/^if \(typeof module !== 'undefined'\).*$/m, '')
    .trim();

fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
for (const name of fs.readdirSync(path.join(dir, 'workflows')).filter((f) => f.endsWith('.json'))) {
  const wf = JSON.parse(fs.readFileSync(path.join(dir, 'workflows', name), 'utf8'));
  for (const node of wf.nodes) {
    const p = node.parameters || {};
    if (p.jsCode === undefined) continue;
    p.jsCode = [].concat(p.jsCode).join('\n').replace(/^\/\/@include (\S+)$/gm, (_, file) => lib(file));
  }
  fs.writeFileSync(path.join(dir, 'dist', name), JSON.stringify(wf, null, 2) + '\n');
}
