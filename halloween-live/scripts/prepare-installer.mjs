import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

// Build an exact uninstall manifest; never recursively delete a user-selected
// installation directory, which may contain unrelated files.
export default async function prepareInstaller(context) {
  if (context.electronPlatformName !== 'win32') return;
  const files = [], dirs = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) { await walk(full); dirs.push(relative(context.appOutDir, full)); }
      else files.push(relative(context.appOutDir, full));
    }
  }
  await walk(context.appOutDir);
  const escape = s => s.replace(/\$/g, '$$$$').replace(/"/g, '$\\"');
  const windows = s => escape(s.replace(/\//g, '\\'));
  const output = join(context.packager.projectDir, '.data');
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'installer-path.nsh'), `!define PIVNIK_APP_OUT_DIR "${escape(context.appOutDir.replace(/\\/g, '/'))}"\n`);
  await writeFile(join(output, 'uninstall-files.nsh'), [
    ...files.map(p => `Delete "$INSTDIR\\${windows(p)}"`),
    ...dirs.map(p => `RMDir "$INSTDIR\\${windows(p)}"`)
  ].join('\n') + '\n');
}
