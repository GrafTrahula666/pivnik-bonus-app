const EVENT_TYPES = new Set([
  'note_added',
  'tag_added',
  'tag_removed',
  'segment_added',
  'segment_removed'
]);

function requireQuery(query) {
  if (typeof query !== 'function') throw new TypeError('query must be a function');
}

function normalizeRequired(value, field) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new TypeError(`${field} is required`);
  }
  return String(value).trim();
}

function normalizeOptional(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  return String(value).trim();
}

function normalizeEventType(value) {
  const eventType = normalizeRequired(value, 'eventType');
  if (!EVENT_TYPES.has(eventType)) throw new TypeError(`Unsupported eventType: ${eventType}`);
  return eventType;
}

function normalizeLimit(value) {
  const limit = value === undefined ? 50 : Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new TypeError('limit must be an integer between 1 and 100');
  }
  return limit;
}

function normalizeOffset(value) {
  const offset = value === undefined ? 0 : Number(value);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new TypeError('offset must be a non-negative integer');
  }
  return offset;
}

function semanticCommand(row) {
  return {
    tenantId: String(row.tenant_id),
    locationId: row.location_id === null ? null : String(row.location_id),
    customerId: String(row.customer_id),
    actorId: String(row.actor_id),
    eventType: String(row.event_type),
    value: String(row.value),
    reason: String(row.reason),
    requestKey: String(row.request_key)
  };
}

function assertReplayMatches(row, command) {
  const existing = semanticCommand(row);
  const matches = Object.keys(existing).every((key) => existing[key] === command[key]);
  if (!matches) {
    throw Object.assign(new Error('Idempotency key already belongs to a different customer metadata command'), {
      code: 'idempotency_conflict',
      existing
    });
  }
  return row;
}

function buildScopePredicate({ tenantId, locationId, customerId }, firstParameter = 1) {
  const clauses = [`tenant_id = $${firstParameter}`, `customer_id = $${firstParameter + 1}`];
  const params = [tenantId, customerId];
  if (locationId !== null) {
    clauses.push(`location_id = $${firstParameter + 2}`);
    params.push(locationId);
  }
  return { sql: clauses.join(' AND '), params };
}

/**
 * Append-only persistence for Customer 360 notes/tags/segments.
 *
 * Authorization remains the caller's responsibility; this repository requires
 * an explicit tenant/customer scope and never falls back to a global query.
 */
export function createCustomerMetadataRepository({ query } = {}) {
  requireQuery(query);

  return Object.freeze({
    async appendEvent({
      tenantId,
      locationId = null,
      customerId,
      actorId,
      eventType,
      value,
      reason,
      requestKey
    } = {}) {
      const command = {
        tenantId: normalizeRequired(tenantId, 'tenantId'),
        locationId: normalizeOptional(locationId),
        customerId: normalizeRequired(customerId, 'customerId'),
        actorId: normalizeRequired(actorId, 'actorId'),
        eventType: normalizeEventType(eventType),
        value: normalizeRequired(value, 'value'),
        reason: normalizeRequired(reason, 'reason'),
        requestKey: normalizeRequired(requestKey, 'requestKey')
      };

      const inserted = await query(
        `INSERT INTO spaceverse_customer_metadata_events (
           tenant_id, location_id, customer_id, actor_id,
           event_type, value, reason, request_key
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (request_key) DO NOTHING
         RETURNING *`,
        [
          command.tenantId,
          command.locationId,
          command.customerId,
          command.actorId,
          command.eventType,
          command.value,
          command.reason,
          command.requestKey
        ]
      );

      if (inserted.rows?.[0]) return inserted.rows[0];

      const replay = await query(
        `SELECT *
         FROM spaceverse_customer_metadata_events
         WHERE request_key = $1`,
        [command.requestKey]
      );
      if (!replay.rows?.[0]) {
        throw Object.assign(new Error('Metadata event idempotency replay could not be resolved'), {
          code: 'idempotency_replay_missing'
        });
      }
      return assertReplayMatches(replay.rows[0], command);
    },

    async listEvents({ tenantId, locationId = null, customerId, limit = 50, offset = 0 } = {}) {
      const scope = {
        tenantId: normalizeRequired(tenantId, 'tenantId'),
        locationId: normalizeOptional(locationId),
        customerId: normalizeRequired(customerId, 'customerId')
      };
      const normalizedLimit = normalizeLimit(limit);
      const normalizedOffset = normalizeOffset(offset);
      const predicate = buildScopePredicate(scope);
      const limitPosition = predicate.params.length + 1;
      const offsetPosition = predicate.params.length + 2;
      const result = await query(
        `SELECT id, tenant_id, location_id, customer_id, actor_id,
                event_type, value, reason, request_key, created_at
         FROM spaceverse_customer_metadata_events
         WHERE ${predicate.sql}
         ORDER BY created_at DESC, id DESC
         LIMIT $${limitPosition} OFFSET $${offsetPosition}`,
        [...predicate.params, normalizedLimit, normalizedOffset]
      );
      return result.rows || [];
    },

    async listCurrentLabels({ tenantId, locationId = null, customerId } = {}) {
      const scope = {
        tenantId: normalizeRequired(tenantId, 'tenantId'),
        locationId: normalizeOptional(locationId),
        customerId: normalizeRequired(customerId, 'customerId')
      };
      const predicate = buildScopePredicate(scope);
      const result = await query(
        `WITH ranked AS (
           SELECT event_type, value, actor_id, reason, created_at, id,
                  CASE
                    WHEN event_type LIKE 'tag_%' THEN 'tag'
                    WHEN event_type LIKE 'segment_%' THEN 'segment'
                  END AS label_kind,
                  ROW_NUMBER() OVER (
                    PARTITION BY
                      CASE
                        WHEN event_type LIKE 'tag_%' THEN 'tag'
                        WHEN event_type LIKE 'segment_%' THEN 'segment'
                      END,
                      value
                    ORDER BY created_at DESC, id DESC
                  ) AS row_number
           FROM spaceverse_customer_metadata_events
           WHERE ${predicate.sql}
             AND event_type IN ('tag_added','tag_removed','segment_added','segment_removed')
         )
         SELECT label_kind, value, actor_id, reason, created_at
         FROM ranked
         WHERE row_number = 1
           AND event_type IN ('tag_added','segment_added')
         ORDER BY label_kind ASC, value ASC`,
        predicate.params
      );
      return result.rows || [];
    }
  });
}

export const customerMetadataRepositoryContract = Object.freeze({
  migration: '010_spaceverse_customer_metadata.sql',
  appendOnly: true,
  destructiveDeletes: false,
  requiresExplicitTenant: true,
  globalFallback: false,
  idempotentWrites: true,
  auditFields: Object.freeze(['actor_id', 'reason', 'request_key', 'created_at']),
  supportedEvents: Object.freeze([...EVENT_TYPES])
});
