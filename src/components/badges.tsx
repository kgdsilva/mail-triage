import type { Disposition, DocStatus } from '@/generated/prisma/enums'

const DISPOSITION_STYLE: Record<Disposition, string> = {
  UNREVIEWED: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  ARCHIVE: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  // Action items are the whole point of the platform — they get the only strong colour.
  ACTION: 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100',
}

const DISPOSITION_LABEL: Record<Disposition, string> = {
  UNREVIEWED: 'Unreviewed',
  ARCHIVE: 'Archived',
  ACTION: 'Action',
}

export function DispositionBadge({ value }: { value: Disposition }) {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${DISPOSITION_STYLE[value]}`}
    >
      {DISPOSITION_LABEL[value]}
    </span>
  )
}

const STATUS_STYLE: Record<DocStatus, string> = {
  WAITING: 'text-amber-700 dark:text-amber-300',
  IN_PROGRESS: 'text-blue-700 dark:text-blue-300',
  DONE: 'text-emerald-700 dark:text-emerald-300',
  ARCHIVED: 'text-neutral-500',
  VOID: 'text-neutral-400 line-through',
}

const STATUS_LABEL: Record<DocStatus, string> = {
  WAITING: 'Waiting',
  IN_PROGRESS: 'In progress',
  DONE: 'Done',
  ARCHIVED: 'Archived',
  VOID: 'Void',
}

export function StatusText({ value }: { value: DocStatus }) {
  return <span className={`text-xs ${STATUS_STYLE[value]}`}>{STATUS_LABEL[value]}</span>
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
