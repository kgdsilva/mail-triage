import type { Disposition, DocStatus } from '@/generated/prisma/enums'
import type { LogFilters } from '@/server/documents'

/**
 * The log's filter state lives entirely in the URL, so a filtered view is a link you
 * can bookmark, share, or hand to the export endpoint unchanged.
 */
export function parseFilters(sp: URLSearchParams): LogFilters {
  const list = (key: string) => sp.getAll(key).flatMap((v) => v.split(',')).filter(Boolean)
  const date = (key: string) => {
    const raw = sp.get(key)
    if (!raw) return undefined
    const d = new Date(`${raw}T00:00:00Z`)
    return Number.isNaN(d.getTime()) ? undefined : d
  }

  const view = sp.get('view')

  return {
    q: sp.get('q') ?? undefined,
    entityIds: list('entity'),
    documentTypeIds: list('type'),
    statuses: list('status') as DocStatus[],
    dispositions: list('disposition') as Disposition[],
    dateFrom: date('from'),
    dateTo: date('to'),
    view: view === 'segregated' || view === 'all' ? view : 'main',
    page: Number(sp.get('page')) || 1,
  }
}

/** Rebuilds the query string with one key changed, preserving everything else. */
export function withParam(sp: URLSearchParams, key: string, value: string | null) {
  const next = new URLSearchParams(sp)
  if (value === null || value === '') next.delete(key)
  else next.set(key, value)
  // Any filter change invalidates the current page number.
  if (key !== 'page') next.delete('page')
  return `?${next.toString()}`
}

/** Toggles one value within a repeatable multi-select filter. */
export function toggleParam(sp: URLSearchParams, key: string, value: string) {
  const current = new Set(sp.getAll(key).flatMap((v) => v.split(',')).filter(Boolean))
  if (current.has(value)) current.delete(value)
  else current.add(value)

  const next = new URLSearchParams(sp)
  next.delete(key)
  if (current.size) next.set(key, [...current].join(','))
  next.delete('page')
  return `?${next.toString()}`
}
