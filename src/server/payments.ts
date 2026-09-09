import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/server/db/client'

export const PAYMENT_INCLUDE = {
  entity: { select: { code: true, legalName: true, sortOrder: true } },
  vendor: { select: { name: true } },
  document: { select: { id: true, originalFilename: true, finalFilename: true } },
  recordedBy: { select: { name: true, email: true } },
} satisfies Prisma.PaymentInclude

export type PaymentFilters = {
  entityId?: string | null
  /** A member sees what they recorded; everyone else sees the group's history. */
  restrictToUserId?: string | null
}

export async function listPayments(companyGroupId: string, filters: PaymentFilters = {}) {
  return prisma.payment.findMany({
    where: {
      companyGroupId,
      ...(filters.entityId ? { entityId: filters.entityId } : {}),
      ...(filters.restrictToUserId ? { recordedByUserId: filters.restrictToUserId } : {}),
    },
    include: PAYMENT_INCLUDE,
    // Most recent first: the history is read to answer "did we pay this", which is
    // almost always about the last few weeks.
    orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }],
    take: 500,
  })
}

/** What the paid screen shows above the list. */
export async function paymentTotals(companyGroupId: string, filters: PaymentFilters = {}) {
  const where = {
    companyGroupId,
    ...(filters.entityId ? { entityId: filters.entityId } : {}),
    ...(filters.restrictToUserId ? { recordedByUserId: filters.restrictToUserId } : {}),
  }

  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)

  const [all, month, missingReceipt] = await Promise.all([
    prisma.payment.aggregate({ where, _sum: { amount: true }, _count: true }),
    prisma.payment.aggregate({
      where: { ...where, paidOn: { gte: monthStart } },
      _sum: { amount: true },
      _count: true,
    }),
    // The number that matters for an audit: paid, but with nothing to show for it.
    prisma.payment.count({ where: { ...where, receiptStorageKey: null } }),
  ])

  return {
    count: all._count,
    total: all._sum.amount ? Number(all._sum.amount.toString()) : 0,
    monthCount: month._count,
    monthTotal: month._sum.amount ? Number(month._sum.amount.toString()) : 0,
    missingReceipt,
  }
}
