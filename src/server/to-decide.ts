/**
 * The money documents still waiting on a decision — the accountant's first tab.
 *
 * ---------------------------------------------------------------------------
 * Why this is a tab and not a screen
 * ---------------------------------------------------------------------------
 *
 * It began as its own inbox and that was the wrong shape. The accountant asks one
 * question across a whole document's life — "does this have to be paid, and is it paid
 * yet" — and splitting that across two pages made him check two places to answer one
 * thing. So it sits where the rest of that answer already lives: Accounting, first tab,
 * before Ready to pay. The order of the tabs is the order of the work.
 *
 * ---------------------------------------------------------------------------
 * What is in it
 * ---------------------------------------------------------------------------
 *
 * A document is here when it involves money (`moneyWhere`) and nobody has decided what
 * to do with it yet — nothing archived, nothing already sent for approval, nothing paid.
 * That is a definition rather than a destination, which matters: the documents appear
 * because of what they are, not because a routing rule put them there, so none can be
 * lost by a rule that failed to fire.
 *
 * The same predicate takes them off the shared board, so each document is in exactly one
 * person's way. Both sides call this module; they cannot drift apart.
 */

import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/server/db/client'
import { moneyWhere } from '@/server/money'
import { entityWhere, visibleEntityIds } from '@/server/scope'
import { APPROVE_ROLES, type Session } from '@/server/session'

/**
 * Undecided: still UNREVIEWED, or handed to somebody as a question rather than as a
 * payment. A document whose entity nobody could determine is excluded — it stays with
 * the person who can work that out, whatever money it mentions.
 */
export function toDecideWhere(companyGroupId: string): Prisma.DocumentWhereInput {
  return {
    companyGroupId,
    deletedAt: null,
    entityId: { not: null },
    approvalStatus: null,
    payments: { none: {} },
    OR: [{ disposition: 'UNREVIEWED' }, { disposition: 'ACTION', actionKind: 'REVIEW' }],
    AND: [moneyWhere()],
  }
}

const SELECT = {
  id: true,
  originalFilename: true,
  finalFilename: true,
  summaryNote: true,
  amount: true,
  dueDate: true,
  documentDate: true,
  createdAt: true,
  disposition: true,
  actionKind: true,
  storageKey: true,
  entity: { select: { id: true, code: true, legalName: true, sortOrder: true } },
  vendor: { select: { name: true } },
  documentType: { select: { code: true, label: true } },
  category: { select: { name: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
  /*
   * The handoff itself, not the assignment.
   *
   * Who a document is assigned to and who handed it over are different facts, and
   * reading the first as the second produced a line saying "kg passed this to you" on
   * every imported document — the importer had set an assignee, and the note shown was
   * the import's own note. Only a `routed` event means a person passed this on, and
   * only its note is the message they meant to leave.
   */
  events: {
    /*
     * The handoff and the reply to it, and nothing else.
     *
     * `note_added` is written by the accounting note path too, and taking the ten newest
     * events of both kinds meant a busy document could push its own `routed` event out
     * of the window — the question would vanish from the card, silently, on exactly the
     * documents that have had the most said about them. Narrowing the filter to the two
     * kinds anybody reads makes ten plenty.
     */
    where: {
      OR: [
        { action: 'routed' },
        { action: 'note_added', toValue: { path: ['by'], equals: 'handover-answer' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      action: true,
      createdAt: true,
      toValue: true,
      actor: { select: { name: true, email: true } },
    },
  },
} satisfies Prisma.DocumentSelect

type EventRow = {
  action: string
  toValue: unknown
  actor: { name: string | null; email: string } | null
}

const whoSaid = (e: EventRow) => e.actor?.name?.trim() || e.actor?.email || 'Somebody'

const noteOn = (e: EventRow): string | null => {
  const v = e.toValue
  if (!v || typeof v !== 'object' || !('note' in v)) return null
  const note = String((v as { note?: unknown }).note ?? '').trim()
  return note || null
}

const isAnswer = (e: EventRow) =>
  e.action === 'note_added' &&
  typeof e.toValue === 'object' &&
  e.toValue !== null &&
  'by' in e.toValue &&
  (e.toValue as { by?: unknown }).by === 'handover-answer'

export type Exchange = {
  asked: { by: string; note: string } | null
  answered: { by: string; note: string } | null
}

/**
 * The question and the answer, as two attributed sentences.
 *
 * ---------------------------------------------------------------------------
 * Why not just show internalNotes
 * ---------------------------------------------------------------------------
 *
 * Because by the time there is an answer, `internalNotes` is the question and the answer
 * concatenated, with nothing saying which is which or who wrote either. It is the right
 * place to keep them — one field, appended to, never overwritten — and the wrong thing
 * to put on a screen.
 *
 * The events have what the field cannot: an actor and an order. So the row reads
 * "Chris asked: … / Danny answered: …", and that is reconstructed rather than parsed.
 *
 * The important difference from `handoff` below: this does not care who the document is
 * assigned to. Answering clears the assignment, which is correct — the question is
 * settled — and it also meant the answer appeared on no queue screen at all, only in the
 * history page. The person who asked got their document back with their own question
 * gone and no reply in sight.
 */
export function exchange(doc: { events: EventRow[] }): Exchange {
  let answered: Exchange['answered'] = null
  let asked: Exchange['asked'] = null

  // Newest first, so the first answer found is the current one and the first routed
  // event after it in the list is the question it answers.
  for (const event of doc.events) {
    if (!answered && isAnswer(event)) {
      const note = noteOn(event)
      if (note) answered = { by: whoSaid(event), note }
      continue
    }
    if (!asked && event.action === 'routed') {
      const note = noteOn(event)
      if (note) asked = { by: whoSaid(event), note }
    }
  }

  return { asked, answered }
}

/** The handoff message, if this document got here by one. */
export function handoff(
  doc: { assignedTo: { id: string } | null; events: EventRow[] },
  viewerId: string,
): { by: string; note: string | null } | null {
  /*
   * A handoff, and not a claim.
   *
   * Taking an item off the shared board records a `routed` event too — same action, same
   * actor shape — so reading "the most recent routed event" made the card announce
   * "kg@colabservice.com passed this to you" to the person who had just pressed "I'll
   * take it". You did not pass it to yourself; you picked it up.
   */
  const event = doc.events.find(
    (e) =>
      e.action === 'routed' &&
      !(
        e.toValue &&
        typeof e.toValue === 'object' &&
        'via' in e.toValue &&
        (e.toValue as { via?: unknown }).via === 'claimed'
      ),
  )
  if (!event) return null
  // Only when it was handed to *this* person: a document routed to somebody else is
  // not a message to the reader.
  if (doc.assignedTo?.id !== viewerId) return null

  const v = event.toValue
  const note =
    v && typeof v === 'object' && 'note' in v ? String((v as { note?: unknown }).note ?? '') : ''
  return { by: event.actor?.name ?? event.actor?.email ?? 'Somebody', note: note || null }
}

/**
 * Soonest deadline first, and undated last.
 *
 * Not undated *first*, which is what a plain ascending sort does with nulls and what
 * every one of these lists got wrong before: a document with no deadline is the least
 * urgent thing on the screen, and putting it at the top buries the notice with eleven
 * days left. Items with no date are not given an invented one — they simply go to the
 * end, which is the agreed behaviour.
 */
export async function listToDecide(session: Session, entityId?: string | null) {
  const scope = await visibleEntityIds(session)
  return prisma.document.findMany({
    where: {
      ...toDecideWhere(session.companyGroupId),
      ...entityWhere(scope),
      ...(entityId ? { entityId } : {}),
    },
    orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    select: SELECT,
    take: 300,
  })
}

export async function countToDecide(session: Session, entityId?: string | null) {
  const scope = await visibleEntityIds(session)
  return prisma.document.count({
    where: {
      ...toDecideWhere(session.companyGroupId),
      ...entityWhere(scope),
      ...(entityId ? { entityId } : {}),
    },
  })
}

/**
 * Who approves for a company, in the order the bill would reach them.
 *
 * Needed before the accountant can send anything for approval, because the answer may
 * be nobody: CCS and OP have no approver today. The button refuses in that case rather
 * than marking a bill as awaiting an approval that will never come — a bill waiting on
 * nobody looks identical to a bill waiting on somebody who is slow, and the difference
 * only surfaces when it is late.
 */
export async function approversFor(companyGroupId: string, entityId: string) {
  const memberships = await prisma.membership.findMany({
    // Everybody who can approve, not everybody who holds the approver role: an owner
    // and an administrator can clear a bill, and asking only for APPROVER reported a
    // company as having nobody while three people who could were signed in.
    where: { companyGroupId, isActive: true, role: { in: [...APPROVE_ROLES] } },
    orderBy: { createdAt: 'asc' },
    select: { entityScope: true, user: { select: { id: true, name: true, email: true } } },
  })

  // An empty scope is refused when an approver is saved, but older rows may predate
  // that rule — and an empty scope means every company, so they do cover this one.
  return memberships
    .filter((m) => m.entityScope.length === 0 || m.entityScope.includes(entityId))
    .map((m) => m.user)
}
