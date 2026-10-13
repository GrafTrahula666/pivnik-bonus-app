import assert from 'node:assert/strict';
import test from 'node:test';

import { createDashboardKpiDrilldownRouteHandler } from '../dashboard-kpi-drilldown-route-handler.js';

function createResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

test('passes authorized tenant scope, metric, period and pagination to runtime', async () => {
  let input;
  const handler = createDashboardKpiDrilldownRouteHandler({
    async getKpiDrilldown(value) { input = value; return { rows: [] }; }
  });
  const res = createResponse();
  const req = {
    params: { tenantId: 'route-tenant', metric: 'active_clients' },
    query: {
      locationId: 'location-1',
      start: '2026-09-01T00:00:00.000Z',
      end: '2026-09-08T00:00:00.000Z',
      limit: '25',
      offset: '50'
    },
    spaceverseAuthorization: {
      context: {},
      requestedScope: { tenantId: 'tenant-1', locationId: null }
    }
  };

  await handler(req, res, (error) => { throw error; });

  assert.deepEqual(input, {
    tenantId: 'tenant-1',
    locationId: 'location-1',
    metric: 'active_clients',
    start: '2026-09-01T00:00:00.000Z',
    end: '2026-09-08T00:00:00.000Z',
    limit: 25,
    offset: 50
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { ok: true, drilldown: { rows: [] } });
});

test('fails closed when authorization context is missing', async () => {
  let calls = 0;
  const handler = createDashboardKpiDrilldownRouteHandler({
    async getKpiDrilldown() { calls += 1; return {}; }
  });
  const res = createResponse();
  await handler({ params: {}, query: {} }, res, (error) => { throw error; });
  assert.equal(calls, 0);
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.code, 'authorization_context_required');
});

test('maps invalid input to 400 and disabled scoped reads to 503', async () => {
  const req = {
    params: { tenantId: 'tenant-1', metric: 'completed_ops' },
    query: {},
    spaceverseAuthorization: { context: {}, requestedScope: { tenantId: 'tenant-1' } }
  };

  const invalid = createDashboardKpiDrilldownRouteHandler({
    async getKpiDrilldown() { throw new TypeError('metric is not supported'); }
  });
  const invalidRes = createResponse();
  await invalid(req, invalidRes, (error) => { throw error; });
  assert.equal(invalidRes.statusCode, 400);

  const disabled = createDashboardKpiDrilldownRouteHandler({
    async getKpiDrilldown() {
      throw Object.assign(new Error('disabled'), { code: 'scoped_reads_disabled', statusCode: 503 });
    }
  });
  const disabledRes = createResponse();
  await disabled(req, disabledRes, (error) => { throw error; });
  assert.equal(disabledRes.statusCode, 503);
  assert.equal(disabledRes.payload.code, 'scoped_reads_disabled');
});
