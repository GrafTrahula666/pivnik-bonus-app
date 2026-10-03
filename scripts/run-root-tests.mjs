import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Business owns its Vitest suite and dependencies. The root Node suite lives
// under test/, including nested directories; never auto-discover other packages.
export function rootTestFiles(root = process.cwd()) {
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filename);
      else if (entry.isFile() && /\.test\.(?:js|mjs|cjs)$/.test(entry.name)) files.push(filename);
    }
  }
  visit(path.join(root, 'test'));
  if (!files.length) throw new Error('No root Node tests found under test/.');
  return files.sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...rootTestFiles()], {
    stdio: 'inherit'
  });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
}
