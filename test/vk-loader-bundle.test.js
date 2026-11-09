import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const bootImage = 'assets/boot/spaceverse-mazut-20261109.webp';

test('built VK bundle loads the gateway loader CSS in order, copies exact bytes and fails if CSS is absent', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'pivnik-vk-loader-'));
  try {
    await fs.mkdir(path.join(temporary, 'scripts'));
    for (const file of ['scripts/build-vk-hosting.mjs', 'index.html', 'app.js', 'vk-platform.js',
      'account-link.js', 'styles.css', 'loader-fix.css', 'service-white-gold.css']) {
      await fs.copyFile(path.join(root, file), path.join(temporary, file));
    }
    await fs.mkdir(path.join(temporary, 'assets/boot'), { recursive: true });
    await fs.copyFile(path.join(root, bootImage), path.join(temporary, bootImage));
    await fs.mkdir(path.join(temporary, 'minigames'), { recursive: true });
    await fs.cp(path.join(root, 'minigames/pivnik-run'), path.join(temporary, 'minigames/pivnik-run'), { recursive: true });
    await fs.symlink(await fs.realpath(path.join(root, 'node_modules')), path.join(temporary, 'node_modules'), 'dir');
    const build = () => execFileSync(process.execPath, ['scripts/build-vk-hosting.mjs'], {
      cwd: temporary, env: { PATH: process.env.PATH, PIVNIK_VK_API_BASE: 'https://vk-gateway.invalid' },
      stdio: 'pipe', timeout: 30_000
    });
    build();
    const html = await fs.readFile(path.join(temporary, 'vk-hosting-build/index.html'), 'utf8');
    const cssPaths = [...html.matchAll(/<link\b[^>]*href="([^"]+)"[^>]*>/g)]
      .map((match) => match[1].split('?')[0].replace(/^\//, ''));
    assert.deepEqual(cssPaths.slice(0, 3), ['styles.css', 'loader-fix.css', 'service-white-gold.css']);
    assert.equal(cssPaths.filter((name) => name === 'loader-fix.css').length, 1);
    assert.match(html, /href="\/loader-fix\.css\?v=2\.3\.0"/);
    assert.doesNotMatch(html, /telegram\.org\/js\/telegram-web-app\.js/);
    assert.deepEqual(await fs.readFile(path.join(temporary, 'vk-hosting-build/loader-fix.css')),
      await fs.readFile(path.join(root, 'loader-fix.css')));

    assert.ok(html.includes(`class="boot-image" src="/${bootImage}"`));
    assert.deepEqual(await fs.readFile(path.join(temporary, 'vk-hosting-build', bootImage)),
      await fs.readFile(path.join(root, bootImage)));

    const run = await fs.readFile(path.join(temporary, 'vk-hosting-build/run/index.html'), 'utf8');
    assert.doesNotMatch(run, /telegram\.org\/js\/telegram-web-app\.js/);
    assert.match(run, /id="exitApp" href="\/"/);
    await fs.access(path.join(temporary, 'vk-hosting-build/run/loc/menu-bg.webp'));

    await fs.unlink(path.join(temporary, 'loader-fix.css'));
    assert.throws(build, (error) => /ENOENT/.test(String(error.stderr))
      && /loader-fix\.css/.test(String(error.stderr)));
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
