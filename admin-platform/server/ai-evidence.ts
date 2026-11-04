import type { VenueScope } from './types.js'

// CHAT 14 / 136. Pure read-only evidence envelope. No model, DB, network,
// billing, arbitrary SQL or user-facing route is connected to this module.
// Its input MUST originate from already authorized server-side metric snapshots.
export type AiEvidenceSource = 'evotor-pos' | 'verified-loyalty'
export type AiEvidenceUnit = 'cents' | 'count' | 'percent' | 'bonus-points'
export type AiCoverage = 'complete' | 'partial' | 'unknown'
export type AiSourceStatus = 'available' | 'unavailable' | 'stale'

export interface AuthorizedAiMetricFact {
  readonly companyId: string
  readonly venueId: string
  readonly snapshotId: string
  readonly metricId: string
  readonly source: AiEvidenceSource
  readonly unit: AiEvidenceUnit
  readonly value: string | null
  readonly status: AiSourceStatus
  readonly coverage: AiCoverage
  readonly asOf: string | null
  readonly period: { readonly from: string; readonly until: string; readonly timeZone: string }
}

export interface AiMetricCitation {
  readonly snapshotId: string
  readonly metricId: string
}

interface ValidatedFact {
  readonly snapshotId: string
  readonly metricId: string
  readonly source: AiEvidenceSource
  readonly unit: AiEvidenceUnit
  readonly value: string
  readonly asOf: string
  readonly period: { readonly from: string; readonly until: string; readonly timeZone: string }
}

export interface AiEvidenceResult {
  readonly schemaVersion: 1
  readonly mode: 'server-evidence-only'
  readonly status: 'ready' | 'insufficient_data'
  readonly message: string
  readonly citedFacts: readonly ValidatedFact[]
  readonly limitations: readonly string[]
}

const unavailable = (reason: string): AiEvidenceResult => ({
  schemaVersion: 1, mode: 'server-evidence-only', status: 'insufficient_data',
  message: 'Недостаточно данных для подтверждённого вывода.',
  citedFacts: [], limitations: [reason],
})

const validReference = (s: string): boolean => /^[a-zA-Z0-9_:.-]{1,128}$/.test(s)
const validDecimal = (v: unknown): v is string =>
  typeof v === 'string' && /^-?(?:0|[1-9][0-9]{0,79})(?:\.[0-9]{1,6})?$/.test(v)

function usable(f: AuthorizedAiMetricFact): f is AuthorizedAiMetricFact & { value: string; asOf: string } {
  const period = f.period
  const from = Date.parse(period?.from ?? '')
  const until = Date.parse(period?.until ?? '')
  const asOf = Date.parse(f.asOf ?? '')
  return f.status === 'available' && f.coverage === 'complete'
    && validDecimal(f.value)
    && typeof f.asOf === 'string' && Number.isFinite(asOf)
    && Number.isFinite(from) && Number.isFinite(until) && until > from
    && typeof period?.timeZone === 'string' && period.timeZone.length > 0
    && (f.source === 'evotor-pos' || f.source === 'verified-loyalty')
    && (f.unit === 'cents' || f.unit === 'count' || f.unit === 'percent' || f.unit === 'bonus-points')
    && validReference(f.metricId) && validReference(f.snapshotId)
}

/**
 * Convert *server-verified*, currently authorized facts into an evidence
 * packet. Caller must re-resolve session/venue/permissions/entitlement on
 * EVERY read and MUST NOT pass model/user-authored fact objects as snapshots.
 * The function deliberately does NOT validate AI prose or causes; that remains
 * a distinct model-output/citation verification gate (CHAT 14 / 137).
 *
 * Fail closed: if a requested citation is missing, duplicated, foreign,
 * stale or incomplete, return no asserted facts, rather than partial success.
 */
export function buildAiEvidence(
  scope: Pick<VenueScope, 'id' | 'companyId'>,
  citations: readonly AiMetricCitation[],
  authorizedFacts: readonly AuthorizedAiMetricFact[],
): AiEvidenceResult {
  if (!validReference(scope.id) || !validReference(scope.companyId) ||
      citations.length < 1 || citations.length > 8) {
    return unavailable('Запрос доказательств недоступен или превышает разрешённый предел.')
  }
  const seen = new Set<string>()
  const citedFacts: ValidatedFact[] = []
  for (const citation of citations) {
    if (!validReference(citation?.snapshotId ?? '') || !validReference(citation?.metricId ?? '')) {
      return unavailable('Ссылка на подтверждённый источник отсутствует.')
    }
    const key = citation.snapshotId + '\u0000' + citation.metricId
    if (seen.has(key)) return unavailable('Повторяющиеся ссылки на источники не допускаются.')
    seen.add(key)
    const matching = authorizedFacts.filter(f =>
      f.snapshotId === citation.snapshotId && f.metricId === citation.metricId &&
      f.companyId === scope.companyId && f.venueId === scope.id,
    )
    if (matching.length !== 1 || !usable(matching[0]!)) {
      return unavailable('Источник, полнота периода или доступ к данным не подтверждены.')
    }
    const fact = matching[0]!
    citedFacts.push({
      snapshotId: fact.snapshotId, metricId: fact.metricId, source: fact.source,
      unit: fact.unit, value: fact.value as string, asOf: fact.asOf as string,
      period: {
        from: fact.period.from, until: fact.period.until, timeZone: fact.period.timeZone,
      },
    })
  }
  return {
    schemaVersion: 1, mode: 'server-evidence-only', status: 'ready',
    message: 'Подтверждённые показатели из авторизованных источников.',
    citedFacts, limitations: [
      'Корреляция и изменение показателя сами по себе не доказывают причину.',
      'Подтверждённая кассовая выручка не является прибылью.',
    ],
  }
}
