/**
 * What is waiting on each person, and whether they have been told.
 *
 * ---------------------------------------------------------------------------
 * Why a sweep and not a trigger
 * ---------------------------------------------------------------------------
 *
 * The obvious design is to send an email whenever something lands in somebody's queue.
 * It is also the design that gets switched off in a week: an upload of thirty documents
 * becomes thirty emails to the same person, and after that nobody reads any of them.
 *
 * So nothing sends on an event. A sweep runs twice a day and asks one question per
 * person — what is waiting on you now, and what of it have I already told you about —
 * and the difference is the email. Grouping falls out for free, an item resolved before
 * the sweep is never mentioned at all, and no screen or action has to remember to
 * notify anybody.
 *
 * ---------------------------------------------------------------------------
 * What counts as waiting
 * ---------------------------------------------------------------------------
 *
 * Each role's section is the same query as that role's screen. An email that disagrees
 * with the page it links to is worse than no email, so there is one definition and both
 * read it.
 */

import { prisma } from '@/server/db/client'
import { listBills } from '@/server/approvals'
import { toDecideWhere } from '@/server/to-decide'
import { canApprove, canTriagePayments, canWork, type Session } from '@/server/session'

/** A person, in the shape the queries want, built from their membership. */
export type Member = Session & { membershipId: string }

export type WaitingItem = {
  documentId: string
  /** What the person is being asked to do, in their words not the schema's. */
  what: string
  title: string
  entityCode: string | null
  amount: string | null
  /** ISO date or null. */
  dueDate: string | null
  /** Where this lives on the site. */
  href: string
}

export type Waiting = {
  member: Member
  items: WaitingItem[]
}

const money = (v: unknown) =>
  v === null || v === undefined
    ? null
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
        Number(String(v)),
      )

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)

/**
 * Everybody who might be owed an email, with their scope.
 *
 * Demo accounts are excluded outright. They exist to be clicked through in a
 * walkthrough, their address is not real, and a sweep that tried to write to
 * `@demo.invalid` would produce a bounce for every one of them on every run.
 */
export async function notifiableMembers(companyGroupId: string): Promise<Member[]> {
  const group = await prisma.companyGroup.findUniqueOrThrow({
    where: { id: companyGroupId },
    select: { name: true },
  })

  const memberships = await prisma.membership.findMany({
    where: {
      companyGroupId,
      isActive: true,
      user: { email: { not: { endsWith: '@demo.invalid' } } },
    },
    select: {
      id: true,
      role: true,
      entityScope: true,
      user: { select: { id: true, name: true, email: true, image: true } },
    },
  })

  return memberships.map((m) => ({
    membershipId: m.id,
    userId: m.user.id,
    companyGroupId,
    role: m.role,
    entityScope: m.entityScope,
    companyGroupName: group.name,
    userName: m.user.name ?? m.user.email,
    userEmail: m.user.email,
    userImage: m.user.image,
  }))
}

/**
 * What is on this person's plate right now.
 *
 * Capped per section: an email is a nudge, not a report. Somebody with ninety things
 * waiting needs to be told that, not sent ninety lines — the count carries the weight
 * and the link carries the detail.
 */
export async function waitingFor(member: Member, limit = 8): Promise<WaitingItem[]> {
  const items: WaitingItem[] = []

  // --- the approver's screen --------------------------------------------------------
  if (canApprove(member.role)) {
    const bills = await listBills(member, { statuses: ['PENDING'] })
    for (const b of bills.slice(0, limit)) {
      items.push({
        documentId: b.id,
        what: 'waiting on your approval',
        title: b.vendor?.name ?? b.finalFilename ?? b.originalFilename,
        entityCode: b.entity?.code ?? null,
        amount: money(b.amount),
        dueDate: day(b.dueDate),
        href: '/approvals',
      })
    }
  }

  // --- the accountant's screen ------------------------------------------------------
  if (canTriagePayments(member.role)) {
    const toDecide = await prisma.document.findMany({
      where: toDecideWhere(member.companyGroupId),
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
      take: limit,
      select: {
        id: true,
        originalFilename: true,
        finalFilename: true,
        amount: true,
        dueDate: true,
        entity: { select: { code: true } },
        vendor: { select: { name: true } },
      },
    })
    for (const d of toDecide) {
      items.push({
        documentId: d.id,
        what: 'needs deciding — is it a bill?',
        title: d.vendor?.name ?? d.finalFilename ?? d.originalFilename,
        entityCode: d.entity?.code ?? null,
        amount: money(d.amount),
        dueDate: day(d.dueDate),
        href: '/accounting',
      })
    }

    const ready = await listBills(member, { statuses: ['APPROVED'], settled: false })
    for (const b of ready.slice(0, limit)) {
      items.push({
        documentId: b.id,
        what: 'approved and waiting to be paid',
        title: b.vendor?.name ?? b.finalFilename ?? b.originalFilename,
        entityCode: b.entity?.code ?? null,
        amount: money(b.amount),
        dueDate: day(b.dueDate),
        href: '/accounting?tab=ready',
      })
    }
  }

  // --- anything handed to this person by name ---------------------------------------
  if (canWork(member.role)) {
    const mine = await prisma.document.findMany({
      where: {
        companyGroupId: member.companyGroupId,
        deletedAt: null,
        status: { in: ['WAITING', 'IN_PROGRESS'] },
        disposition: 'ACTION',
        assignedToUserId: member.userId,
      },
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
      take: limit,
      select: {
        id: true,
        originalFilename: true,
        finalFilename: true,
        amount: true,
        dueDate: true,
        entity: { select: { code: true } },
        vendor: { select: { name: true } },
      },
    })
    for (const d of mine) {
      // Not duplicated: a bill already listed above as the approver's is the same
      // document, and saying it twice in one email reads as a bug.
      if (items.some((i) => i.documentId === d.id)) continue
      items.push({
        documentId: d.id,
        what: 'assigned to you',
        title: d.vendor?.name ?? d.finalFilename ?? d.originalFilename,
        entityCode: d.entity?.code ?? null,
        amount: money(d.amount),
        dueDate: day(d.dueDate),
        href: '/',
      })
    }
  }

  return items
}

/**
 * Of those, the ones this person has not already been emailed about.
 *
 * The `notification` table has been in the schema since the first migration and unused
 * ever since; this is what it was for. One row per person per document, written when
 * the email goes out, and its presence is what stops the same item being mentioned
 * every twelve hours forever.
 *
 * `after` re-opens an item that has been sitting a long time: the point of a reminder
 * is that silence is not the same as handled.
 */
export async function unTold(
  member: Member,
  items: WaitingItem[],
  remindAfterDays = 7,
): Promise<WaitingItem[]> {
  if (items.length === 0) return []

  const told = await prisma.notification.findMany({
    where: {
      userId: member.userId,
      documentId: { in: items.map((i) => i.documentId) },
      sentAt: { not: null },
    },
    select: { documentId: true, sentAt: true },
  })

  const cutoff = Date.now() - remindAfterDays * 86_400_000
  const recent = new Set(
    told.filter((t) => t.sentAt !== null && t.sentAt.getTime() > cutoff).map((t) => t.documentId),
  )

  return items.filter((i) => !recent.has(i.documentId))
}

/** Records that these were sent, so the next sweep does not repeat them. */
export async function markTold(member: Member, items: WaitingItem[]) {
  const now = new Date()
  for (const item of items) {
    await prisma.notification.create({
      data: {
        userId: member.userId,
        documentId: item.documentId,
        channel: 'EMAIL',
        sentAt: now,
      },
    })
  }
}
