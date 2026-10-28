import type { ReactNode } from 'react'

export type SortDirection = 'asc' | 'desc'
export type SortValue = string | number | bigint | null | undefined

// Explicitly preserve the distinction between missing data and zero.
export function compareValues(left: SortValue, right: SortValue, direction: SortDirection): number {
  if (left == null) return right == null ? 0 : 1
  if (right == null) return -1
  const result = typeof left === 'string' && typeof right === 'string'
    ? left.localeCompare(right, 'ru', { numeric: true, sensitivity: 'base' })
    : left < right ? -1 : left > right ? 1 : 0
  return direction === 'asc' ? result : -result
}

export function sortTableRows<T>(rows: readonly T[], value: (item: T) => SortValue, direction: SortDirection): T[] {
  return [...rows].sort((a, b) => compareValues(value(a), value(b), direction))
}

export function SortTh({ label, column, sort, direction, onSort, initialDirection = 'desc' }: {
  label: ReactNode
  column: string
  sort: string
  direction: SortDirection
  onSort: (column: string, direction: SortDirection) => void
  initialDirection?: SortDirection
}) {
  const active = column === sort
  const next: SortDirection = active ? (direction === 'asc' ? 'desc' : 'asc') : initialDirection
  return <th aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
    <button type="button" className="table-sort-button" onClick={() => onSort(column, next)}
      aria-label={`Сортировать по: ${typeof label === 'string' ? label : column}. ${next === 'desc' ? 'По убыванию' : 'По возрастанию'}`}>
      <span>{label}</span><span className={active ? 'table-sort-icon active' : 'table-sort-icon'} aria-hidden="true">
        {active ? direction === 'desc' ? '↓' : '↑' : '↕'}
      </span>
    </button>
  </th>
}
