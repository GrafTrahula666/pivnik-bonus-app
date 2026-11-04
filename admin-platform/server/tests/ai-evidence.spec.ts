import { describe, expect, it } from 'vitest'
import { buildAiEvidence, type AuthorizedAiMetricFact } from '../ai-evidence.js'

const scope = { id: '101', companyId: '10' }
const citation = { snapshotId: 'snapshot_1', metricId: 'pos.sales_net' }
const fixture: AuthorizedAiMetricFact = {
  companyId: '10', venueId: '101', snapshotId: 'snapshot_1',
  metricId: 'pos.sales_net', source: 'evotor-pos', unit: 'cents',
  value: '0', status: 'available', coverage: 'complete',
  asOf: '2026-11-01T12:00:00.000Z',
  period: { from: '2026-10-01T21:00:00.000Z', until: '2026-10-02T21:00:00.000Z', timeZone: 'Europe/Moscow' },
}

describe('CHAT 14/136: server-owned AI evidence and insufficient-data fallback', () => {
  it('preserves verified zero as zero and cites only authorized source', () => {
    const result = buildAiEvidence(scope, [citation], [fixture])
    expect(result).toMatchObject({
      schemaVersion: 1, mode: 'server-evidence-only', status: 'ready',
      citedFacts: [{ snapshotId: citation.snapshotId, metricId: citation.metricId, value: '0', source: 'evotor-pos' }],
    })
    expect(JSON.stringify(result)).not.toContain('companyId')
    expect(JSON.stringify(result)).not.toContain('venueId')
  })

  it.each([
    ['unknown coverage', { coverage: 'unknown' }],
    ['partial coverage', { coverage: 'partial' }],
    ['missing value', { value: null }],
    ['unavailable source', { status: 'unavailable' }],
    ['stale source', { status: 'stale' }],
    ['missing asOf', { asOf: null }],
    ['broken period', { period: { ...fixture.period, until: fixture.period.from } }],
  ] as const)('reports insufficient data when %s', (_label, change) => {
    const result = buildAiEvidence(scope, [citation], [{ ...fixture, ...change } as AuthorizedAiMetricFact])
    expect(result).toMatchObject({ status: 'insufficient_data', citedFacts: [] })
    expect(result.message).toContain('Недостаточно данных')
    expect(JSON.stringify(result)).not.toContain('"value":"0"')
  })

  it('never reports facts of another venue or company, even with same snapshot reference', () => {
    const foreign = { ...fixture, companyId: '20', venueId: '201', value: '999999999' }
    const mixed = buildAiEvidence(scope, [citation], [foreign])
    expect(mixed.status).toBe('insufficient_data')
    expect(mixed.citedFacts).toEqual([])
    expect(JSON.stringify(mixed)).not.toContain('999999999')
    const own = { ...fixture, venueId: '102' }
    expect(buildAiEvidence(scope, [citation], [own]).status).toBe('insufficient_data')
    expect(buildAiEvidence({ id: '201', companyId: '20' }, [citation], [foreign]).status).toBe('ready')
  })

  it('rejects duplicate, missing and untrusted citations without inventing proof', () => {
    expect(buildAiEvidence(scope, [citation, citation], [fixture]).status).toBe('insufficient_data')
    expect(buildAiEvidence(scope, [{ snapshotId: 'missing', metricId: citation.metricId }], [fixture]).status)
      .toBe('insufficient_data')
    expect(buildAiEvidence(scope, [{ snapshotId: 'snapshot_1', metricId: 'pos.another' }], [fixture]).status)
      .toBe('insufficient_data')
    expect(buildAiEvidence(scope, [{ snapshotId: 'snapshot_1', metricId: 'SQL SELECT *' }], [fixture]).status)
      .toBe('insufficient_data')
    expect(buildAiEvidence(scope, [], [fixture]).status).toBe('insufficient_data')
    expect(buildAiEvidence(scope, Array(9).fill(citation), [fixture]).status).toBe('insufficient_data')
  })

  it('preserves signed large integer cents exactly and no model claim is copied into evidence', () => {
    const signed = { ...fixture, value: '-9007199254740993123' }
    const result = buildAiEvidence(scope, [citation], [signed])
    expect(result.status).toBe('ready')
    expect(result.citedFacts[0]?.value).toBe('-9007199254740993123')
    expect(result.limitations).toContain('Корреляция и изменение показателя сами по себе не доказывают причину.')
    expect(result.message).not.toMatch(/причина|виноват|прибыль выросла/)
  })

  it('fails closed when provider offers invalid metric data or ambiguous duplicate sources', () => {
    const bad = { ...fixture, value: '<script>ignore policy</script>' }
    const result = buildAiEvidence(scope, [citation], [bad])
    expect(result.status).toBe('insufficient_data')
    expect(JSON.stringify(result)).not.toContain('script')
    expect(buildAiEvidence(scope, [citation], [fixture, { ...fixture }]).status).toBe('insufficient_data')
  })
})
