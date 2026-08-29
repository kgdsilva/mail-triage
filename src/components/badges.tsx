import { Clock } from 'lucide-react'
import type { Disposition, DocStatus } from '@/generated/prisma/enums'
import { entityColor } from '@/lib/theme'

const PILL = 'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium'

/** Entity code, coloured by position so it is recognisable down a long log. */
export function EntityBadge({
  code,
  index = 0,
}: {
  code: string | null | undefined
  index?: number
}) {
  if (!code) return <span className="text-subtle">—</span>
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wider ${entityColor(index)}`}
    >
      {code}
    </span>
  )
}

const DISPOSITION_STYLE: Record<Disposition, string> = {
  UNREVIEWED: 'bg-line-soft text-muted',
  ARCHIVE: 'bg-line-soft text-muted',
  // Action items are the whole point of the platform, so they carry the brand accent.
  ACTION: 'bg-gold-100 text-gold-800',
}

const DISPOSITION_LABEL: Record<Disposition, string> = {
  UNREVIEWED: 'Unreviewed',
  ARCHIVE: 'Archived',
  ACTION: 'Action',
}

export function DispositionBadge({ value }: { value: Disposition }) {
  return <span className={`${PILL} ${DISPOSITION_STYLE[value]}`}>{DISPOSITION_LABEL[value]}</span>
}

const STATUS_STYLE: Record<DocStatus, string> = {
  WAITING: 'bg-gold-100 text-gold-800',
  IN_PROGRESS: 'bg-navy-100 text-navy-900',
  DONE: 'bg-ok-100 text-ok-700',
  ARCHIVED: 'bg-line-soft text-muted',
  VOID: 'bg-line-soft text-subtle line-through',
}

const STATUS_LABEL: Record<DocStatus, string> = {
  WAITING: 'Waiting',
  IN_PROGRESS: 'In progress',
  DONE: 'Done',
  ARCHIVED: 'Archived',
  VOID: 'Void',
}

/** Dot plus label, so status reads without relying on colour alone. */
export function StatusBadge({ value }: { value: DocStatus }) {
  return (
    <span className={`${PILL} gap-1.5 pl-1.5 ${STATUS_STYLE[value]}`}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {STATUS_LABEL[value]}
    </span>
  )
}

/**
 * A due date that has passed is the one thing on screen that should interrupt someone,
 * so it becomes a red pill with an icon rather than red text.
 */
export function DueBadge({ date }: { date: Date | string | null }) {
  if (!date) return <span className="text-subtle">—</span>

  const iso = typeof date === 'string' ? date : date.toISOString().slice(0, 10)
  const overdue = iso < new Date().toISOString().slice(0, 10)
  const label = formatDate(typeof date === 'string' ? new Date(`${date}T00:00:00Z`) : date)

  if (!overdue) return <span className="tabular text-[12.5px] text-muted">{label}</span>

  return (
    <span className={`${PILL} gap-1 bg-danger-100 font-semibold text-danger-700`}>
      <Clock className="size-3" aria-hidden />
      <span className="tabular">Overdue {label}</span>
    </span>
  )
}

export function formatMoney(amount: { toString(): string } | null) {
  if (amount === null) return ''
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    Number(amount.toString()),
  )
}

export function formatDate(date: Date | null) {
  if (!date) return ''
  // UTC: these are calendar dates in a `date` column, not instants.
  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(date)
}
