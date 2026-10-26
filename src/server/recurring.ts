/**
 * Standing obligations, and whether this month's has been paid.
 *
 * ---------------------------------------------------------------------------
 * Why a month is a string
 * ---------------------------------------------------------------------------
 *
 * The period is `YYYY-MM` rather than a date, because the question this screen answers
 * is "has October been paid", not "was something paid on a day in October". A retainer
 * for October settled on the 3rd of November is October's, and anything that derived the
 * month from the payment date would mark November done and leave October owing — which
 * is the exact failure the feature exists to prevent, reproduced by the feature.
 *
 * ---------------------------------------------------------------------------
 * Why there is no generated row
 * ---------------------------------------------------------------------------
 *
 * The obvious design is a job that writes a "due" row each month. It is also the design
 * that goes wrong quietly: the job misses a month, or runs twice, or runs for an
 * obligation that ended, and from then on the screen and the truth disagree with nobody
 * able to say which is which.
 *
 * So nothing is generated. A month is owed if the obligation was in effect during it and
 * no payment carries that period. Both halves are facts already in the database, the
 * answer is computed on sight, and there is no state to drift.
 */

import { prisma } from '@/server/db/client'
import type { Prisma } from '@/generated/prisma/client'

/** `YYYY-MM` for a date, in no particular timezone — the month is a label, not an instant. */
export function periodOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

/** The month before this one, for showing what is still owed from it. */
export function previousPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

/**
 * The day this obligation falls due in that month.
 *
 * The 31st of February is not an error to refuse; it is somebody saying "the end of the
 * month". A retainer due on the 31st is owed in February, and clamping is the only
 * reading that does not silently skip four months a year.
 */
export function dueDateFor(period: string, dayOfMonth: number): Date {
  const [year, month] = period.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return new Date(Date.UTC(year, month - 1, Math.min(dayOfMonth, lastDay)))
}

export type RecurringMonth = {
  id: string
  payeeName: string
  entityId: string
  entityCode: string
  /** What it usually is, or null when it varies. */
  amount: Prisma.Decimal | null
  dayOfMonth: number
  method: string | null
  notes: string | null
  period: string
  dueDate: Date
  /** Set when this month has been settled. */
  paid: { id: string; amount: Prisma.Decimal; paidOn: Date; recordedBy: string } | null
  /** Days past due, or 0 when it is not yet due. */
  daysLate: number
}

/** Was this obligation live at any point during that month? */
function inEffect(
  r: { effectiveFrom: Date; effectiveTo: Date | null },
  period: string,
): boolean {
  const [year, month] = period.split('-').map(Number)
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 0))
  if (r.effectiveFrom > monthEnd) return false
  if (r.effectiveTo !== null && r.effectiveTo < monthStart) return false
  return true
}

/**
 * Every obligation for the months given, with its payment if it has one.
 *
 * Two months rather than one on the screens that use it: a retainer missed in September
 * does not stop being owed when October starts, and a list that only ever shows the
 * current month is how a missed month disappears on the 1st.
 */
export async function recurringFor(
  companyGroupId: string,
  periods: string[],
  entityIds?: string[] | null,
): Promise<RecurringMonth[]> {
  const rules = await prisma.recurringPayment.findMany({
    where: {
      companyGroupId,
      ...(entityIds ? { entityId: { in: entityIds } } : {}),
    },
    include: {
      entity: { select: { code: true } },
      payments: {
        where: { recurringPeriod: { in: periods } },
        select: {
          id: true,
          amount: true,
          paidOn: true,
          recurringPeriod: true,
          recordedBy: { select: { name: true, email: true } },
        },
      },
    },
    orderBy: [{ payeeName: 'asc' }],
  })

  const today = new Date()
  const out: RecurringMonth[] = []

  for (const r of rules) {
    for (const period of periods) {
      if (!inEffect(r, period)) continue

      const payment = r.payments.find((p) => p.recurringPeriod === period) ?? null
      const dueDate = dueDateFor(period, r.dayOfMonth)
      const daysLate =
        payment === null && dueDate < today
          ? Math.floor((today.getTime() - dueDate.getTime()) / 86_400_000)
          : 0

      out.push({
        id: r.id,
        payeeName: r.payeeName,
        entityId: r.entityId,
        entityCode: r.entity.code,
        amount: r.amount,
        dayOfMonth: r.dayOfMonth,
        method: r.method,
        notes: r.notes,
        period,
        dueDate,
        paid: payment
          ? {
              id: payment.id,
              amount: payment.amount,
              paidOn: payment.paidOn,
              recordedBy: payment.recordedBy.name ?? payment.recordedBy.email,
            }
          : null,
        daysLate,
      })
    }
  }

  // Owed first, latest first within that, so the screen opens on what is wrong.
  return out.sort((a, b) => {
    if ((a.paid === null) !== (b.paid === null)) return a.paid === null ? -1 : 1
    return a.dueDate.getTime() - b.dueDate.getTime()
  })
}

/**
 * The months owed right now: this one and the last, unpaid and past their due date.
 *
 * What both the Accounting line and the email reminder ask for. Nothing that is not yet
 * due appears — an obligation due on the 28th is not a problem on the 3rd, and listing
 * it as one teaches people that the list is noise.
 */
export async function recurringOwed(
  companyGroupId: string,
  entityIds?: string[] | null,
): Promise<RecurringMonth[]> {
  const now = periodOf(new Date())
  const months = await recurringFor(companyGroupId, [previousPeriod(now), now], entityIds)
  return months.filter((m) => m.paid === null && m.daysLate >= 0 && m.dueDate <= new Date())
}
