import assert from 'node:assert/strict';
import test from 'node:test';

import { createDashboardPeriodSummaryRouteHandler } from '../dashboard-period-summary-route-handler.js';

function createResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

test('passes authorized tenant scope, optional location and explicit period to runtime', async () => {
  let input;
  const handler = createDashboardPeriodSummaryRouteHandler({
    async getPeriodSummary(value) {
      input = value;
      return { metrics: { completedOps: { current: 3 } } };
    }
  });
  const res = createResponse();
  const req = {
    params: { tenantId: 'route-tenant' },
    query: {
      locationId: 'location-1',
      start: '2026-09-01T00:00:00.000Z',
      end: '2026-09-08T00:00:00.000Z'
    },
    spaceverseAuthorization: {
      context: { platformRole: null, memberships: [] },
      requestedScope: { tenantId: 'tenant-1', locationId: null }
    }
  };

  await handler(req, res, (error) => { throw error; });

  assert.deepEqual(input, {
    tenantId: 'tenant-1',
    locationId: 'location-1',
    start: '2026-09-01T00:00:00.000Z',
    end: '2026-09-08T00:00:00.000Z'
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, {
    ok: true,
    summary: { metrics: { completedOps: { current: 3 } } }
  });
});

test('fails closed when scoped authorization middleware did not run', async () => {
  let calls = 0;
  const handler = createDashboardPeriodSummaryRouteHandler({
    async getPeriodSummary() { calls += 1; return {}; }
  });
  const res = createResponse();

  await handler({ params: {}, query: {} }, res, (error) => { throw error; });

  assert.equal(calls, 0);
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.code, 'authorization_context_required');
});

test('maps invalid periods to 400 and disabled scoped reads to 503', async () => {
  const invalidHandler = createDashboardPeriodSummaryRouteHandler({
    async getPeriodSummary() { throw new RangeError('period.end must be after period.start'); }
  });
  const disabledHandler = createDashboardPeriodSummaryRouteHandler({
    async getPeriodSummary() {
      throw Object.assign(new Error('disabled'), { code: 'scoped_reads_disabled', statusCode: 503 });
    }
  });
  const req = {
    params: { tenantId: 'tenant-1' },
    query: {},
    spaceverseAuthorization: {
      context: {},
      requestedScope: { tenantId: 'tenant-1', locationId: null }
    }
  };

  const invalidRes = createResponse();
  await invalidHandler(req, invalidRes, (error) => { throw error; });
  assert.equal(invalidRes.statusCode, 400);

  const disabledRes = createResponse();
  await disabledHandler(req, disabledRes, (error) => { throw error; });
  assert.equal(disabledRes.statusCode, 503);
  assert.equal(disabledRes.payload.code, 'scoped_reads_disabled');
});
