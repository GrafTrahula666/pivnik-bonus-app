import test from 'node:test';
import assert from 'node:assert/strict';
import { createKioskShiftServer } from '../kiosk-shifts/server.js';

test('standalone kiosk server answers health and keeps shifts disabled by default', async () => {
  const pool = { query: async () => ({ rows: [], rowCount: 0 }), connect: async () => ({}) };
  const { server } = createKioskShiftServer({ pool, sessionSecret: 'x'.repeat(40), env: {}, startWorker: false });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    const disabled = await fetch(`${base}/api/kiosk/v1/status`);
    assert.equal(disabled.status, 404);
    assert.equal((await disabled.json()).code, 'disabled');
    assert.equal((await fetch(`${base}/api/anything-else`)).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
