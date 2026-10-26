/**
 * Filling in the categories the log never had.
 *
 * Phase B of docs/PLAN-types.md. Phase A gave 107 documents a category because it
 * followed from the old type; the rest cannot be derived from anything already stored —
 * only 20 of 459 carry a vendor, and until this week the reader did not return a
 * category at all. So the remaining ones have to be read.
 *
 * ---------------------------------------------------------------------------
 * The one rule
 * ---------------------------------------------------------------------------
 *
 * This writes `category_id` and nothing else. Not the type, not the disposition, not the
 * assignee, not `ai_suggestion`. Every one of those is either a decision a person made
 * or a decision this is not entitled to revisit — 459 documents have been classified by
 * hand or by the import, and a backfill that quietly re-decided them would be the
 * single most expensive mistake available here.
 *
 * A document that already has a category is skipped outright, so a person's choice is
 * never overwritten even once.
 */

import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/server/db/client'
import { NOT_MONEY_TYPE_CODES } from '@/server/money'

/** Sonnet, measured on this group's own mail: about half a cent per document. */
const PER_DOCUMENT = 1_850 * (2 / 1_000_000) + 260 * (10 / 1_000_000)

export function estimate(documents: number) {
  return documents * PER_DOCUMENT
}

/**
 * Documents that can be categorised: a file to read, no category yet, and real.
 *
 * Demo rows are excluded — they are seeded with categories already and are not what
 * anybody is paying to classify.
 */
export function needsCategoryWhere(companyGroupId: string): Prisma.DocumentWhereInput {
  return {
    companyGroupId,
    deletedAt: null,
    isDemo: false,
    storageKey: { not: null },
    categoryId: null,
    /*
     * Not a cheque, and not spam.
     *
     * A category here means a spend category, and a cheque this office *received* is
     * money arriving — there is no spend to categorise, so the only honest answer is
     * none. The first run did not know that and read 123 of them anyway: the model was
     * asked an unanswerable question 123 times, answered "Other" 123 times, and the bill
     * for that was about four dollars. The question was wrong, not the answer.
     *
     * `NOT_MONEY_TYPE_CODES` already said which types these are; this is the third place
     * to use it rather than a fourth list that can drift from the other three.
     */
    OR: [
      { documentType: { is: null } },
      { documentType: { is: { code: { notIn: [...NOT_MONEY_TYPE_CODES] } } } },
    ],
    /*
     * And not already looked at.
     *
     * Without this the run never finishes and keeps paying: a document the reader found
     * no category for stays null, so the next slice picks it up, reads it again, finds
     * nothing again, forever. Every document the backfill has seen gets a `categorised`
     * event — whether or not a category was found — and that event is what takes it out
     * of the queue. A null category after a read is an answer, not an unfinished job.
     */
    events: { none: { action: 'categorised' } },
  }
}

/**
 * The documents the first pass could not place, for a second pass with a better list.
 *
 * The first backfill ran against seven categories that described a software company —
 * Technology, Legal, Insurance, Marketing, Office/Rent, Utilities, Other — while this
 * office's mail is tax notices, unemployment agencies, title companies, banks,
 * collections and tolls. Nearly everything landed in "Other", correctly: nothing else
 * fitted. The reading was sound; the choices were not.
 *
 * So this targets exactly what that list failed on — a category of "Other" or none —
 * and nothing else. A document the first pass filed as Insurance or Legal is left
 * alone: those answers were available and were chosen, and paying to re-ask a question
 * that was already answered is how a backfill becomes a subscription.
 *
 * ---------------------------------------------------------------------------
 * Whose answer is being replaced
 * ---------------------------------------------------------------------------
 *
 * The machine's, and only the machine's. This first gated on `reclassified` as well, to
 * protect a person's choice — and that was wrong twice over. Every imported document
 * carries a `reclassified` event from its original classification, so the gate excluded
 * the entire log and the queue was always empty; and reclassifying does not set a
 * category anyway. Narrowing to Other-or-nothing is what actually does the protecting:
 * any document holding a real category is already out of scope, whoever put it there.
 *
 * Worth saying plainly, because it is a gap rather than a design: no screen lets anybody
 * set a category by hand. The only writers are this backfill and the reader's
 * suggestion. So if a category here comes out wrong, there is currently nowhere to
 * correct it — which is a thing to build, not a thing to leave implied.
 *
 * `recategorised` is what takes a document out of this queue, exactly as `categorised`
 * does for the first pass — including when the second pass also finds nothing, so a
 * document that fits none of the fourteen is read once more and then never again.
 */
export function needsRereadWhere(
  companyGroupId: string,
  otherCategoryId: string | null,
): Prisma.DocumentWhereInput {
  return {
    companyGroupId,
    deletedAt: null,
    isDemo: false,
    storageKey: { not: null },
    // Cheques and spam, same as the first pass: there is no spend to file.
    OR: [
      { documentType: { is: null } },
      { documentType: { is: { code: { notIn: [...NOT_MONEY_TYPE_CODES] } } } },
    ],
    // What the old list failed on, and only that.
    AND: [
      {
        OR: [
          { categoryId: null },
          ...(otherCategoryId ? [{ categoryId: otherCategoryId }] : []),
        ],
      },
      { events: { some: { action: 'categorised' } } },
      { events: { none: { action: 'recategorised' } } },
    ],
  }
}

/** The id of the catch-all, which is the category this pass exists to empty. */
export async function otherCategoryId(companyGroupId: string): Promise<string | null> {
  const row = await prisma.category.findFirst({
    where: { companyGroupId, name: { equals: 'Other', mode: 'insensitive' } },
    select: { id: true },
  })
  return row?.id ?? null
}

export async function rereadProgress(companyGroupId: string) {
  const other = await otherCategoryId(companyGroupId)
  const remaining = await prisma.document.count({
    where: needsRereadWhere(companyGroupId, other),
  })
  return { remaining, estimate: estimate(remaining) }
}

export async function categoryProgress(companyGroupId: string) {
  const [remaining, filled, noFile] = await Promise.all([
    prisma.document.count({ where: needsCategoryWhere(companyGroupId) }),
    prisma.document.count({
      where: { companyGroupId, deletedAt: null, isDemo: false, categoryId: { not: null } },
    }),
    // Nothing to read, so nothing this can do — said out loud rather than left as a
    // number that never reaches zero.
    prisma.document.count({
      where: { companyGroupId, deletedAt: null, isDemo: false, storageKey: null, categoryId: null },
    }),
  ])
  return { remaining, filled, noFile, estimate: estimate(remaining) }
}

/** The categories the reader is allowed to choose from, by name. */
export async function categoryByName(companyGroupId: string) {
  const rows = await prisma.category.findMany({
    where: { companyGroupId, isActive: true },
    select: { id: true, name: true },
  })
  return new Map(rows.map((c) => [c.name.toLowerCase(), c.id]))
}
