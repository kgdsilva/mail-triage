'use server'

/**
 * Creating standing obligations, and ticking off a month.
 *
 * Two different permissions on purpose. Deciding that the office owes a lawyer every
 * month is configuration, so it is an administrator's. Recording that this month went
 * out is settling a payment, so it is whoever may record payments — Danny pays some of
 * these, and a control that stopped him recording what he paid would only produce a
 * ledger that is missing his payments.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { prisma } from '@/server/db/client'
import { visibleEntityIds } from '@/server/scope'
import { requireAdmin, requireSettler } from '@/server/session'
import { periodOf } from '@/server/recurring'

/**
 * What these answer back.
 *
 * Returned rather than thrown, for the reason written out in actions/settings.ts: a
 * thrown message never reaches a production browser, so a refusal that throws is a
 * refusal nobody can read.
 */
export type Saved = { ok: true } | { ok: false; error: string }

function fault(err: unknown): Saved {
  return { ok: false, error: err instanceof Error ? err.message : 'That could not be saved.' }
}

const recurringSchema = z.object({
  entityId: z.string().min(1, 'Choose which company owes this'),
  vendorId: z.string().optional(),
  payeeName: z.string().trim().min(1, 'Say who gets paid').max(120),
  amount: z.string().trim().optional(),
  dayOfMonth: z.coerce.number().int().min(1).max(31),
  method: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the month it starts'),
})

export async function saveRecurringPayment(formData: FormData): Promise<Saved> {
  try {
    const session = await requireAdmin()
    const parsed = recurringSchema.safeParse(Object.fromEntries(formData))
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' }
    }
    const data = parsed.data

    const entity = await prisma.entity.findFirst({
      where: { id: data.entityId, companyGroupId: session.companyGroupId },
      select: { id: true },
    })
    if (!entity) return { ok: false, error: 'That company is not in this workspace.' }

    /*
     * A vendor is optional, but a vendor from somewhere else is not: an obligation
     * pointing at another workspace's vendor would render that workspace's name on this
     * one's screen.
     */
    let vendorId: string | null = null
    if (data.vendorId) {
      const vendor = await prisma.vendor.findFirst({
        where: { id: data.vendorId, companyGroupId: session.companyGroupId },
        select: { id: true },
      })
      if (!vendor) return { ok: false, error: 'That payee is not in this workspace.' }
      vendorId = vendor.id
    }

    let amount: number | null = null
    if (data.amount) {
      const n = Number(data.amount.replace(/[^0-9.-]/g, ''))
      if (!Number.isFinite(n) || n <= 0) {
        return { ok: false, error: 'Leave the amount blank if it varies, or enter one above zero.' }
      }
      amount = n
    }

    await prisma.recurringPayment.create({
      data: {
        companyGroupId: session.companyGroupId,
        entityId: entity.id,
        vendorId,
        payeeName: data.payeeName,
        amount,
        dayOfMonth: data.dayOfMonth,
        method: data.method || null,
        notes: data.notes || null,
        effectiveFrom: new Date(`${data.effectiveFrom}T00:00:00Z`),
        createdByUserId: session.userId,
      },
    })

    revalidatePath('/settings/autopay')
    revalidatePath('/accounting')
    return { ok: true }
  } catch (err) {
    return fault(err)
  }
}

/**
 * Ends an obligation rather than deleting it.
 *
 * The payments already recorded against it point here for their label. Deleting the row
 * would leave a year of retainer payments reading as money that went to nobody.
 */
export async function endRecurringPayment(id: string): Promise<Saved> {
  try {
    const session = await requireAdmin()
    const { count } = await prisma.recurringPayment.updateMany({
      where: { id, companyGroupId: session.companyGroupId, effectiveTo: null },
      data: { effectiveTo: new Date() },
    })
    if (count === 0) return { ok: false, error: 'That one is already ended, or not in this workspace.' }

    revalidatePath('/settings/autopay')
    revalidatePath('/accounting')
    return { ok: true }
  } catch (err) {
    return fault(err)
  }
}

const confirmSchema = z.object({
  id: z.string().min(1),
  period: z.string().regex(/^\d{4}-\d{2}$/, 'Which month?'),
  amount: z.string().trim().min(1, 'Enter what was paid'),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date it was paid'),
  reference: z.string().trim().optional(),
})

/**
 * Records that a month of a standing obligation was paid.
 *
 * It writes an ordinary `payment` row carrying the obligation and the month. That is the
 * whole mechanism: there is no separate "ticked" state to keep in step with the ledger,
 * so the Paid tab, the entity totals and this screen cannot disagree about whether the
 * retainer went out — they are all reading the same row.
 */
export async function confirmRecurringPaid(formData: FormData): Promise<Saved> {
  try {
    const session = await requireSettler()
    const parsed = confirmSchema.safeParse(Object.fromEntries(formData))
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' }
    }
    const data = parsed.data

    const scope = await visibleEntityIds(session)
    const rule = await prisma.recurringPayment.findFirst({
      where: {
        id: data.id,
        companyGroupId: session.companyGroupId,
        ...(scope === null ? {} : { entityId: { in: scope } }),
      },
      select: { id: true, entityId: true, vendorId: true, payeeName: true, method: true },
    })
    if (!rule) return { ok: false, error: 'That obligation is not yours to settle.' }

    const amount = Number(data.amount.replace(/[^0-9.-]/g, ''))
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, error: 'Enter an amount greater than zero.' }
    }

    /*
     * A month that is not yet a month cannot be paid.
     *
     * Without this, a mistyped period — 2027-01 instead of 2026-01 — marks a month that
     * has not happened as settled, and the obligation then goes quiet for a year. The
     * only way to notice would be to read the table.
     */
    if (data.period > periodOf(new Date())) {
      return { ok: false, error: 'That month has not started yet.' }
    }

    try {
      await prisma.payment.create({
        data: {
          companyGroupId: session.companyGroupId,
          entityId: rule.entityId,
          vendorId: rule.vendorId,
          payeeName: rule.vendorId ? null : rule.payeeName,
          amount,
          paidOn: new Date(`${data.paidOn}T00:00:00Z`),
          method: rule.method,
          reference: data.reference || null,
          note: `Recurring payment for ${data.period}`,
          recurringPaymentId: rule.id,
          recurringPeriod: data.period,
          recordedByUserId: session.userId,
        },
      })
    } catch (err) {
      /*
       * The unique index on (obligation, month) did its job: two people ticked the same
       * month, or somebody double-clicked. Say so plainly — the money is recorded once,
       * which is the outcome wanted, so this is not really a failure.
       */
      if (err instanceof Error && err.message.includes('Unique constraint')) {
        return { ok: false, error: `${data.period} is already recorded as paid.` }
      }
      throw err
    }

    revalidatePath('/accounting')
    revalidatePath('/paid')
    return { ok: true }
  } catch (err) {
    return fault(err)
  }
}
