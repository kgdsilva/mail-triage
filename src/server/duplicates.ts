/**
 * Identical files, and which copy survives.
 *
 * "Identical" here means one thing only: the same sha256. That is the same bytes, which
 * in practice means the same file reached the upload box twice — a folder re-dragged, a
 * scan saved and sent again, a batch run from a machine that had already run it. Two
 * separate scans of the same piece of paper are *not* byte-identical, and neither is the
 * same invoice re-sent by a vendor, so nothing here can mistake two genuine documents
 * for one. That narrowness is the whole reason this is safe to do automatically.
 *
 * Removal is `deletedAt`, the same soft delete the Log's own remove button uses: the row,
 * the stored file and the entire event history stay exactly where they were, the document
 * drops out of every list, and anything removed can be listed and put back. No bytes are
 * destroyed by any of this, including the stored object — a restored duplicate has to
 * still open, so its file is left alone.
 *
 * Two kinds of identical file are nevertheless left for a person, because for them
 * "identical" stops meaning "sent twice by accident":
 *
 *   - one a payment or an approval points at, since a decision is referencing that
 *     particular row and which copy it belongs to is not a thing to guess;
 *   - one filed to a *different company* than its twin, which is how a single state or
 *     payroll notice that genuinely applies to two of the entities looks in here. The
 *     schema has `SAME_ISSUE_AS` for exactly that, so this case is real and not
 *     hypothetical — and in the log right now there are two such pairs.
 */

import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/server/db/client'

export const DUPLICATE_NOTE = 'Identical file content (sha256) already in the log.'

/** Enough of a document to decide whether it is the copy worth keeping. */
export type Candidate = {
  id: string
  sha256: string | null
  createdAt: Date
  /** UNREVIEWED means nobody has decided anything about it yet. */
  disposition: string
  finalFilename: string | null
  storageFolderId: string | null
  /** Set once a bill enters the approval flow. */
  approvalStatus: string | null
  paymentCount: number
  entityId: string | null
  originalFilename: string
}

export type HoldBackReason = 'decision-points-at-it' | 'different-company'

/** Held back from automatic removal, and why. */
export type HeldBack = { doc: Candidate; reason: HoldBackReason }

/**
 * Why this copy may not be removed automatically, or null if it may.
 *
 * `keeper` is the copy it would be removed in favour of — needed because being filed to
 * a different company is a property of the pair, not of one document.
 */
export function holdBackReason(doc: Candidate, keeper: Candidate): HoldBackReason | null {
  // Money and approvals: a decision somebody made names this row.
  if (doc.paymentCount > 0 || doc.approvalStatus !== null) return 'decision-points-at-it'

  // Both actually filed somewhere, and not to the same place. A copy with no entity yet
  // is an unparsed guess, not a decision, so it does not count as disagreement.
  if (doc.entityId !== null && keeper.entityId !== null && doc.entityId !== keeper.entityId) {
    return 'different-company'
  }

  return null
}

/** How far along a document is. Higher wins. */
function progress(doc: Candidate): number {
  let score = 0
  if (doc.disposition !== 'UNREVIEWED') score += 1
  if (doc.finalFilename) score += 1
  if (doc.storageFolderId) score += 1
  return score
}

/**
 * Which copy to keep out of a group of identical files.
 *
 * The work somebody already did on a copy is the thing that is actually scarce — the
 * bytes exist either way. So the most-progressed copy wins: classified beats raw, filed
 * beats unfiled. Age only breaks a tie, and then the oldest wins, because that is the one
 * the log's own history and any link already point at.
 *
 * On upload this never has to choose: a row created a second ago has no work on it, so
 * the newcomer is the one that goes. It matters for the backlog sweep, where both copies
 * have been sitting there and one of them may well have been classified.
 */
export function pickKeeper(group: Candidate[]): Candidate {
  return [...group].sort((a, b) => {
    const byProgress = progress(b) - progress(a)
    if (byProgress !== 0) return byProgress
    return a.createdAt.getTime() - b.createdAt.getTime()
  })[0]
}

const CANDIDATE_SELECT = {
  id: true,
  sha256: true,
  createdAt: true,
  disposition: true,
  finalFilename: true,
  storageFolderId: true,
  approvalStatus: true,
  entityId: true,
  originalFilename: true,
  _count: { select: { payments: true } },
} satisfies Prisma.DocumentSelect

function toCandidate(row: {
  id: string
  sha256: string | null
  createdAt: Date
  disposition: string
  finalFilename: string | null
  storageFolderId: string | null
  approvalStatus: string | null
  entityId: string | null
  originalFilename: string
  _count: { payments: number }
}): Candidate {
  const { _count, ...rest } = row
  return { ...rest, paymentCount: _count.payments }
}

export type DuplicateGroup = {
  sha256: string
  keeper: Candidate
  /** The copies that would be removed. Never includes the keeper. */
  extras: Candidate[]
  /** Copies left for a person, each with the reason. */
  heldBack: HeldBack[]
}

/**
 * Every group of identical live files, already resolved into keep-and-remove.
 *
 * `entityIds` is the caller's entity boundary — null for roles that see everything. A
 * group is only returned when *all* of its copies fall inside that boundary: acting on
 * half a group would mean deciding what to keep while part of the evidence is invisible,
 * and the one thing worse than a duplicate is removing the copy somebody could see and
 * keeping the one they could not.
 */
export async function duplicateGroups(
  companyGroupId: string,
  entityIds: string[] | null,
): Promise<DuplicateGroup[]> {
  const repeated = await prisma.$queryRaw<{ sha256: string }[]>`
    SELECT sha256
    FROM document
    WHERE company_group_id = ${companyGroupId}
      AND deleted_at IS NULL
      AND sha256 IS NOT NULL
    GROUP BY sha256
    HAVING count(*) > 1
  `
  if (repeated.length === 0) return []

  const rows = await prisma.document.findMany({
    where: {
      companyGroupId,
      deletedAt: null,
      sha256: { in: repeated.map((r) => r.sha256) },
    },
    select: CANDIDATE_SELECT,
  })

  const bySha = new Map<string, Candidate[]>()
  for (const row of rows) {
    const doc = toCandidate(row)
    if (!doc.sha256) continue
    const list = bySha.get(doc.sha256) ?? []
    list.push(doc)
    bySha.set(doc.sha256, list)
  }

  const groups: DuplicateGroup[] = []
  for (const [sha256, group] of bySha) {
    if (group.length < 2) continue

    // The whole group has to be visible, or it is not this caller's to resolve.
    if (entityIds !== null) {
      const allVisible = group.every((d) => d.entityId !== null && entityIds.includes(d.entityId))
      if (!allVisible) continue
    }

    const keeper = pickKeeper(group)
    const rest = group.filter((d) => d.id !== keeper.id)
    const extras: Candidate[] = []
    const heldBack: HeldBack[] = []
    for (const doc of rest) {
      const reason = holdBackReason(doc, keeper)
      if (reason) heldBack.push({ doc, reason })
      else extras.push(doc)
    }
    groups.push({ sha256, keeper, extras, heldBack })
  }

  return groups
}

/** What the Review screen needs to know without listing anything. */
export async function duplicateCounts(companyGroupId: string, entityIds: string[] | null) {
  const groups = await duplicateGroups(companyGroupId, entityIds)
  return {
    removable: groups.reduce((n, g) => n + g.extras.length, 0),
    heldBack: groups.reduce((n, g) => n + g.heldBack.length, 0),
  }
}
