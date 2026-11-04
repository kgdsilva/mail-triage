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
import { recurringOwed } from '@/server/recurring'
import { canApprove, canTriagePayments, canWork, type Session } from '@/server/session'

/** A person, in the shape the queries want, built from their membership. */
export type Member = Session & { membershipId: string }

export type WaitingItem = {
  /**
   * What this item is, for the "have I said this already" check.
   *
   * A document id for almost everything. A standing monthly payment has no document —
   * nothing arrives in the post for a retainer, which is the whole reason it needs
   * chasing — so it carries `recurring` instead and is tracked on its own row rather
   * than in `notification`, which can only point at a document.
   */
  documentId: string | null
  recurring?: { id: string; period: string }
  /** What the person is being asked to do, in their words not the schema's. */
  what: string
  title: string
  entityCode: string | null
  amount: string | null
  /** ISO date or null. */
  dueDate: string | null
  /** Where this lives on the site. */
  href: string
  /**
   * Something changed at this moment, so the usual "already told you about this
   * document" rule does not apply — only an email sent *after* this counts as having
   * said it. Without it a reply to a question would be silently swallowed by the
   * reminder the document had already earned days earlier.
   */
  since?: Date
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

/** Where a person goes to read a reply to a question they asked. */
function askerHref(role: string): string {
  // Only two kinds of person can hand a document over: the accountant, from the money
  // queue, and the office, from the shared board. Each gets back the screen they asked
  // from, which is also the screen the answer is now printed on.
  return canTriagePayments(role) && !canWork(role) ? '/accounting' : '/'
}

/** Where a person goes to answer something handed to them, given what they can open. */
function handedHref(role: string): string {
  if (canApprove(role) && !canWork(role)) return '/approvals?tab=handed'
  if (canTriagePayments(role) && !canWork(role)) return '/accounting?tab=handed'
  return '/'
}

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

  /*
   * --- money nothing will ever remind anyone of ---------------------------------------
   *
   * Last in the list and first in importance. Every other item here exists because a
   * piece of paper arrived; this one exists because none did. A retainer has no invoice,
   * no scan and no queue — if this email does not mention it, nothing does.
   */
  if (canTriagePayments(member.role)) {
    const owed = await recurringOwed(member.companyGroupId, member.entityScope.length > 0 ? member.entityScope : null)
    for (const r of owed.slice(0, limit)) {
      items.push({
        documentId: null,
        recurring: { id: r.id, period: r.period },
        what: 'monthly payment, nothing will invoice you for it',
        title: r.payeeName,
        entityCode: r.entityCode,
        amount: r.amount === null ? null : money(r.amount),
        dueDate: day(r.dueDate),
        href: '/accounting',
      })
    }
  }

  /*
   * --- a question you asked, now answered ---------------------------------------------
   *
   * The last thing in the loop that nothing told anybody about. Answering clears the
   * assignment and the document drops back into the asker's queue looking exactly as it
   * left — their own question gone, the reply on the document but on no list. They found
   * out by opening the queue, or seven days later when the reminder came round again.
   *
   * Matched through the events rather than a column, because "who asked" is not stored
   * on the document: the handoff is a `routed` event with an actor, and the reply is a
   * `note_added` written by answerHandover. A document is in this list when both exist
   * and the asker was you.
   */
  {
    const since = new Date(Date.now() - 30 * 86_400_000)

    const answers = await prisma.documentEvent.findMany({
      where: {
        action: 'note_added',
        toValue: { path: ['by'], equals: 'handover-answer' },
        createdAt: { gte: since },
        document: { companyGroupId: member.companyGroupId, deletedAt: null },
      },
      orderBy: { createdAt: 'desc' },
      take: limit * 2,
      select: {
        documentId: true,
        createdAt: true,
        actor: { select: { name: true, email: true } },
        document: {
          select: {
            originalFilename: true,
            finalFilename: true,
            amount: true,
            dueDate: true,
            entity: { select: { code: true } },
            vendor: { select: { name: true } },
          },
        },
      },
    })

    if (answers.length > 0) {
      // Whose question it was. One query for the whole batch rather than one per answer.
      const asked = new Set(
        (
          await prisma.documentEvent.findMany({
            where: {
              action: 'routed',
              actorUserId: member.userId,
              documentId: { in: answers.map((a) => a.documentId) },
            },
            select: { documentId: true },
          })
        ).map((e) => e.documentId),
      )

      for (const answer of answers) {
        if (!asked.has(answer.documentId)) continue

        const who = answer.actor?.name?.trim() || answer.actor?.email || 'Somebody'

        /*
         * Upgraded rather than skipped when the document is already on the list.
         *
         * Which it almost always is, and that was the bug: the accountant asks about a
         * document in his own money queue, so the section above has already added it as
         * "needs deciding". Skipping meant the one new fact — somebody answered — was
         * dropped, and with it the `since` that was the only reason the email would go
         * out at all for a document mentioned days earlier. The feature never fired for
         * the case it was written for.
         */
        const already = items.find((i) => i.documentId === answer.documentId)
        if (already) {
          already.what = `${who} answered your question`
          already.href = askerHref(member.role)
          already.since = answer.createdAt
          continue
        }

        items.push({
          documentId: answer.documentId,
          what: `${who} answered your question`,
          title:
            answer.document.vendor?.name ??
            answer.document.finalFilename ??
            answer.document.originalFilename,
          entityCode: answer.document.entity?.code ?? null,
          amount: money(answer.document.amount),
          dueDate: day(answer.document.dueDate),
          href: askerHref(member.role),
          /*
           * The reply is news even though the document is not. It has almost certainly
           * been emailed about days earlier, and the ordinary "already told you about
           * this document" rule would swallow the one line that matters.
           */
          since: answer.createdAt,
        })
      }
    }
  }

  /*
   * --- anything handed to this person by name -----------------------------------------
   *
   * Not gated by role, and that is the fix rather than an oversight.
   *
   * It used to require `canWork`, which is OWNER/ADMIN/OPERATOR/MEMBER/VIEWER — so the
   * two people this office actually hands documents to, the approver and the accountant,
   * were the two the email never reached. Every open handover in the database is
   * addressed to the accountant. He was emailed about the money queue and never about
   * the question somebody put his name on.
   *
   * The permission is the same one `answerHandover` uses: your name is on the document.
   * That is narrower than any role check, and it is the only one that matches what the
   * screens now show.
   */
  {
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
        actionKind: true,
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
        what:
          d.actionKind === 'REVIEW'
            ? 'somebody has a question for you'
            : 'assigned to you',
        title: d.vendor?.name ?? d.finalFilename ?? d.originalFilename,
        entityCode: d.entity?.code ?? null,
        amount: money(d.amount),
        dueDate: day(d.dueDate),
        // The screen this person can actually open. An approver cannot reach the shared
        // board and the accountant cannot either, so a link to it was a link to a
        // refusal — which is how "Chris passed this to you" became impossible to find.
        href: handedHref(member.role),
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

  const documentIds = items
    .map((i) => i.documentId)
    .filter((id): id is string => id !== null)

  const told = documentIds.length === 0
    ? []
    : await prisma.notification.findMany({
        where: {
          userId: member.userId,
          documentId: { in: documentIds },
          sentAt: { not: null },
        },
        select: { documentId: true, sentAt: true },
      })

  const cutoff = Date.now() - remindAfterDays * 86_400_000
  const recent = new Set(
    told.filter((t) => t.sentAt !== null && t.sentAt.getTime() > cutoff).map((t) => t.documentId),
  )

  /** The last time this person was written to about each document. */
  const lastTold = new Map<string, number>()
  for (const t of told) {
    if (!t.sentAt) continue
    lastTold.set(t.documentId, Math.max(lastTold.get(t.documentId) ?? 0, t.sentAt.getTime()))
  }

  /*
   * A monthly payment is mentioned once for its month, not once a week.
   *
   * Weekly would be wrong in both directions: four emails for one retainer, and the
   * second one arriving before anybody has had a chance to act on the first. Once the
   * month is paid the item is gone from `waitingFor` anyway, so the mark is only ever
   * read while it is still owed.
   */
  const remindedPeriods = new Map<string, string | null>(
    (
      await prisma.recurringPayment.findMany({
        where: {
          id: { in: items.flatMap((i) => (i.recurring ? [i.recurring.id] : [])) },
        },
        select: { id: true, lastRemindedPeriod: true },
      })
    ).map((r) => [r.id, r.lastRemindedPeriod]),
  )

  return items.filter((i) => {
    if (i.recurring) return remindedPeriods.get(i.recurring.id) !== i.recurring.period
    if (i.documentId === null) return false
    // Something happened to this one; the question is whether we have said so since.
    if (i.since) return (lastTold.get(i.documentId) ?? 0) < i.since.getTime()
    return !recent.has(i.documentId)
  })
}

/**
 * Records that these were sent, so the next sweep does not repeat them.
 *
 * `markShared` is false for a one-person run — the "send mine now" button. A monthly
 * payment's mark is shared by everybody who would be told about it, so marking it from
 * a test would mean somebody checking that email works thereby cancels this month's
 * reminder for the accountant. Per-person marks are safe either way and still written.
 */
export async function markTold(
  member: Member,
  items: WaitingItem[],
  { markShared = true }: { markShared?: boolean } = {},
) {
  const now = new Date()
  for (const item of items) {
    if (item.recurring) {
      if (!markShared) continue
      /*
       * Marked on the obligation, not against this person — `notification` has nowhere
       * to put something that is not a document. The consequence is honest and small:
       * one reminder covers every accountant, who share the job and the answer.
       */
      await prisma.recurringPayment.update({
        where: { id: item.recurring.id },
        data: { lastRemindedPeriod: item.recurring.period },
      })
      continue
    }
    if (item.documentId === null) continue
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
