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

import { prisma } from '@/server/db/client'

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
export function needsCategoryWhere(companyGroupId: string) {
  return {
    companyGroupId,
    deletedAt: null,
    isDemo: false,
    storageKey: { not: null },
    categoryId: null,
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
  } as const
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
