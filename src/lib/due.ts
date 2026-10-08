/**
 * A due date, said the way somebody asks about it.
 *
 * "Due 10/19" makes you do arithmetic against today's date before you know whether it
 * matters. "5 days overdue" is the answer to the question you were actually asking, and
 * on a screen whose entire job is deciding what to pay first, that arithmetic is the
 * work. The exact date stays available in a tooltip, because reconciling against an
 * invoice needs the real thing.
 *
 * Dates here are calendar dates from a `date` column, so everything is computed in UTC.
 * A local-time comparison would call a bill due tomorrow "due today" for anyone west of
 * the line, which is the one direction this must not be wrong in.
 */

export type DueTone = 'overdue' | 'soon' | 'later' | 'none'

export type Due = {
  /** What to show. */
  text: string
  tone: DueTone
  /** The exact date, for the tooltip. Empty when there is no due date. */
  exact: string
  /** Negative when overdue. Null when there is no due date. */
  days: number | null
}

const DAY = 86_400_000

/** Midnight UTC today, as a timestamp, so the comparison is date-to-date. */
function todayUtc() {
  const now = new Date()
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
}

export function describeDue(iso: string | null): Due {
  if (!iso) return { text: 'No due date', tone: 'none', exact: '', days: null }

  const due = Date.parse(`${iso}T00:00:00Z`)
  if (Number.isNaN(due)) return { text: 'No due date', tone: 'none', exact: '', days: null }

  const days = Math.round((due - todayUtc()) / DAY)
  const exact = new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(due)

  if (days < 0) {
    const n = Math.abs(days)
    return { text: `${n} day${n === 1 ? '' : 's'} overdue`, tone: 'overdue', exact, days }
  }
  if (days === 0) return { text: 'Due today', tone: 'soon', exact, days }
  if (days === 1) return { text: 'Due tomorrow', tone: 'soon', exact, days }

  // Three days, not the week the queues use: an approver is being asked whether this is
  // urgent for them today.
  if (days <= 3) return { text: `Due in ${days} days`, tone: 'soon', exact, days }

  const short = new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
  }).format(due)
  return { text: `Due ${short}`, tone: 'later', exact, days }
}

/**
 * All four are pills of the same geometry, including the quiet ones.
 *
 * The padding and height were already identical — measured, 8px by 2px, 21px tall. What
 * made the neutral date look misaligned was having no background at all: a coloured
 * pill's *box* starts at the column edge while bare text starts 8px inside it, so the
 * eye reads the plain one as indented even though its baseline matches. A faint
 * background costs nothing and makes the column line up by construction rather than by
 * luck, and weight still does the work of saying which ones are urgent.
 */
export const DUE_TONE: Record<DueTone, string> = {
  overdue: 'bg-danger-100 text-danger-700 font-bold',
  soon: 'bg-gold-100 text-gold-800 font-semibold',
  later: 'bg-line-soft text-muted font-medium',
  none: 'bg-line-soft/60 text-subtle font-medium',
}
