// PostToolUse: node --check on edited .js/.mjs files.
import { execFileSync } from 'node:child_process';
const input = JSON.parse(await new Promise((r) => { let d = ''; process.stdin.on('data', (c) => d += c); process.stdin.on('end', () => r(d || '{}')); }));
const file = input.tool_input?.file_path;
if (file && /\.(m?js)$/.test(file)) {
  try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); }
  catch (e) { console.error(`Syntax error in ${file}:\n${e.stderr}`); process.exit(2); }
}
