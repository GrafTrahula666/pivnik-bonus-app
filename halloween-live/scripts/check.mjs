import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
for (const dir of ['src', 'desktop', 'scripts', 'public', 'test']) {
  for (const file of readdirSync(dir).filter(f => /\.(js|cjs|mjs)$/.test(f) && !f.endsWith('.bundle.js'))) {
    const result = spawnSync(process.execPath, ['--check', `${dir}/${file}`], { stdio: 'inherit' });
    if (result.status) process.exit(result.status);
  }
}
