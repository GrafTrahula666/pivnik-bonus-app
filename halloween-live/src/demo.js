import { start } from './server.js';

// Portable entry point: npm scripts must also work in Windows cmd/PowerShell.
start({ ...process.env, LIVE_MODE: 'demo' }).catch(() => {
  console.error('Не удалось запустить отдельное демо. Проверьте каталог данных и порт.');
  process.exitCode = 1;
});
