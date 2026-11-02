/**
 * The same bill twice, when it is not the same file twice.
 *
 * ---------------------------------------------------------------------------
 * Why this is separate from duplicates.ts, and must stay separate
 * ---------------------------------------------------------------------------
 *
 * `duplicates.ts` compares sha256 — the same bytes, which means one file reached the
 * upload box twice. That narrowness is what makes removing the extra copy safe to do
 * automatically, and nothing here changes it.
 *
 * This is the other failure, and it is the expensive one. Two separate scans of the same
 * notice are not byte-identical; neither is a vendor's re-sent invoice, or the same bill
 * arriving once by post and once by email. The two CBE Group notices in the log share a
 * company, a vendor, a case reference and a cent-exact amount, and differ in every byte.
 * A byte comparison cannot see them, and paying both is money gone.
 *
 * So the output of this module is a **warning to a person, never an action**. Nothing
 * here removes, merges, or blocks anything. The reason is in the data: two of the groups
 * it would once have flagged are a monthly retainer, and one is a collection agency
 * sending the same demand every month for the same debt — all three genuinely two
 * documents. The system cannot tell those from a double-billing, and a system that
 * guesses at that either deletes a real bill or trains people to dismiss it.
 *
 * ---------------------------------------------------------------------------
 * How the rule was arrived at
 * ---------------------------------------------------------------------------
 *
 * By running candidate rules over the real log, because the obvious rule is wrong.
 * "Same vendor and same amount" sounds like a duplicate and, over these 484 documents,
 * fires 22 times — and almost all of it is incoming cheques: this office takes a flat
 * processing fee, so fifty cheques from fifty different clients share a vendor and the
 * cent. One group had fifty members. A warning that is wrong fifty times out of
 * fifty-one is worse than no warning, because it teaches the reader to click past it.
 *
 * Hence the three narrowings below, each of which removed real noise rather than
 * hypothetical noise:
 *
 *   1. money going out only — incoming cheques and solicitations are never considered,
 *      which is what the fifty-member group was;
 *   2. a contradicting reference suppresses it — two invoice numbers that both exist and
 *      differ are two invoices, whatever else they share;
 *   3. and because the invoice-number column is empty on nearly every row in practice,
 *      the reference is also read out of the filename, which is where this office has
 *      always written it: MUNAR INV-2026-1135 and MUNAR INV-2026-1134 are the same
 *      vendor, the same day and the same amount, and are not the same invoice.
 *
 * Against the log as it stands the rule flags exactly one pair — the CBE notices — and
 * nothing else. That is the number to re-check when this changes.
 */

import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/server/db/client'
import { NOT_MONEY_TYPE_CODES } from '@/server/money'

/** How much the match is worth believing. Ordered: a reader sees the worst one first. */
export type Strength = 'strong' | 'likely' | 'possible'

export type NearMatch = {
  id: string
  title: string
  strength: Strength
  /** What the two have in common, and what sets them apart, in one phrase. */
  why: string
  /** What has already happened to the other one — the part that makes this urgent. */
  state: string
}

const STRENGTH_ORDER: Record<Strength, number> = { strong: 0, likely: 1, possible: 2 }

/**
 * Reference-looking tokens in a filename.
 *
 * Four characters or more and containing a digit, which is what an invoice number, a
 * cheque number or a case reference looks like and what a word does not. Dates are
 * dropped: every filename in this office begins with one, they differ between any two
 * documents, and leaving them in would suppress every warning this module exists to
 * raise.
 */
export function refTokens(name: string): Set<string> {
  const base = name.replace(/\.[a-z0-9]{2,4}$/i, '')
  const tokens = new Set<string>()

  for (const raw of base.toUpperCase().split(/[^A-Z0-9-]+/)) {
    const token = raw.replace(/^-+|-+$/g, '')
    if (token.length < 4) continue
    if (!/\d/.test(token)) continue
    // 9-8-26, 10/13/26 — the date this office puts in front of every name.
    if (/^\d{1,2}[-/]\d{1,2}([-/]\d{2,4})?$/.test(token)) continue
    tokens.add(token)
  }

  return tokens
}

type Subject = {
  id: string
  entityId: string | null
  vendorId: string | null
  amount: Prisma.Decimal | null
  invoiceNumber: string | null
  documentDate: Date | null
  createdAt: Date
  sha256: string | null
  originalFilename: string
  finalFilename: string | null
  isDemo: boolean
  approvalStatus: string | null
  approvalDecidedAt: Date | null
  approvalDecidedBy: { name: string | null; email: string } | null
  payments: { paidOn: Date }[]
}

const SUBJECT_SELECT = {
  id: true,
  entityId: true,
  vendorId: true,
  amount: true,
  invoiceNumber: true,
  documentDate: true,
  createdAt: true,
  sha256: true,
  originalFilename: true,
  finalFilename: true,
  isDemo: true,
  approvalStatus: true,
  approvalDecidedAt: true,
  approvalDecidedBy: { select: { name: true, email: true } },
  payments: { select: { paidOn: true }, orderBy: { paidOn: 'desc' as const }, take: 1 },
} satisfies Prisma.DocumentSelect

const nameOf = (d: Subject) => d.finalFilename ?? d.originalFilename

const day = (date: Date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/**
 * Whether these two are worth putting in front of somebody, and why.
 *
 * Pure, and the entire judgement of this module. Both arguments have already been
 * narrowed to the same company, vendor and amount by the query — this decides whether
 * that coincidence means anything.
 */
export function compare(a: Subject, b: Subject): { strength: Strength; why: string } | null {
  // The byte-identical case belongs to duplicates.ts, which can act on it. Saying it
  // twice in two different words would send somebody looking for two problems.
  if (a.sha256 && a.sha256 === b.sha256) return null

  const invA = a.invoiceNumber?.trim()
  const invB = b.invoiceNumber?.trim()
  if (invA && invB && invA !== invB) return null

  const tokensA = refTokens(nameOf(a))
  const tokensB = refTokens(nameOf(b))
  if (tokensA.size > 0 && tokensB.size > 0 && ![...tokensA].some((t) => tokensB.has(t))) {
    return null
  }

  if (invA && invB && invA === invB) {
    return { strength: 'strong', why: `same invoice number, ${invA}` }
  }

  const dated = a.documentDate && b.documentDate
  const days = dated
    ? Math.round(Math.abs(+a.documentDate! - +b.documentDate!) / 86_400_000)
    : null

  if (days !== null && days <= 10) {
    return {
      strength: 'likely',
      why: days === 0 ? 'both dated the same day' : `dated ${days} day${days === 1 ? '' : 's'} apart`,
    }
  }

  /*
   * Further apart, or undated. This is the monthly-notice shape as well as the
   * double-billing shape, and the label says how far apart precisely so the reader can
   * tell which — "36 days apart" reads as a monthly cycle to anybody who knows the
   * vendor, and the system does not have to pretend it knows.
   */
  return {
    strength: 'possible',
    why: days === null ? 'one of them is undated' : `dated ${days} days apart`,
  }
}

/** What has already been done to the other copy, which is why this is worth reading. */
function stateOf(d: Subject): string {
  if (d.payments[0]) return `already paid on ${day(d.payments[0].paidOn)}`

  switch (d.approvalStatus) {
    case 'APPROVED': {
      const who = d.approvalDecidedBy?.name?.trim() || d.approvalDecidedBy?.email
      const when = d.approvalDecidedAt ? ` on ${day(d.approvalDecidedAt)}` : ''
      return `already approved${who ? ` by ${who}` : ''}${when} and waiting to be paid`
    }
    case 'PENDING':
      return 'already waiting on an approver'
    case 'NEEDS_REVIEW':
      return 'already sent back with a question'
    case 'DENIED':
      return 'was refused'
    default:
      return `in the log since ${day(d.createdAt)}`
  }
}

/**
 * Money going out, and nothing else.
 *
 * Written as an exclusion rather than an inclusion because the inclusive version —
 * `moneyWhere` — deliberately lets a document in on the strength of carrying an amount,
 * which an incoming cheque always does. Here the cheques are the entire problem, so they
 * are refused twice: by type, and by the reason they were filed under.
 */
const OUTGOING: Prisma.DocumentWhereInput = {
  deletedAt: null,
  amount: { not: null },
  vendorId: { not: null },
  entityId: { not: null },
  NOT: { documentType: { code: { in: [...NOT_MONEY_TYPE_CODES] } } },
  dispositionReason: { not: 'INCOMING_CHECK' },
}

/**
 * For each of these documents, the others that might be the same bill.
 *
 * Two queries whatever the length of the list: the documents themselves, then every
 * candidate sharing any of their company/vendor/amount triples. A per-row query would be
 * three hundred round trips to answer a question about five.
 */
export async function nearDuplicatesFor(
  companyGroupId: string,
  documentIds: string[],
): Promise<Map<string, NearMatch[]>> {
  const found = new Map<string, NearMatch[]>()
  if (documentIds.length === 0) return found

  const subjects = (await prisma.document.findMany({
    where: { id: { in: documentIds }, companyGroupId, ...OUTGOING },
    select: SUBJECT_SELECT,
  })) as Subject[]
  if (subjects.length === 0) return found

  /*
   * Deduplicated, because a screen showing thirty bills from one vendor for one amount
   * would otherwise send thirty identical clauses into the same OR. In this log the
   * subjects collapse from hundreds of rows to about a dozen triples.
   */
  const seen = new Set<string>()
  const triples: Prisma.DocumentWhereInput[] = []
  for (const s of subjects) {
    const key = `${s.entityId}|${s.vendorId}|${s.amount?.toString()}`
    if (seen.has(key)) continue
    seen.add(key)
    triples.push({ entityId: s.entityId, vendorId: s.vendorId, amount: s.amount })
  }

  /*
   * The subjects are not excluded from the candidates, and that is deliberate.
   *
   * Excluding them is the obvious reading of "find the others", and it is wrong whenever
   * both copies are on the same screen — which is the common case, since a bill that
   * arrived twice arrives into the same queue. Written that way this module reported
   * nothing at all over the whole log: every document was a subject, so every document
   * was excluded from being anybody's match. Self-pairing is ruled out per row instead,
   * where it is a fact about two ids and not about the query.
   */
  const candidates = (await prisma.document.findMany({
    where: {
      companyGroupId,
      ...OUTGOING,
      OR: triples,
    },
    select: SUBJECT_SELECT,
    take: 500,
  })) as Subject[]
  if (candidates.length === 0) return found

  for (const subject of subjects) {
    const matches: NearMatch[] = []

    for (const other of candidates) {
      if (other.id === subject.id) continue
      if (other.entityId !== subject.entityId) continue
      if (other.vendorId !== subject.vendorId) continue
      if (other.amount?.toString() !== subject.amount?.toString()) continue
      // A demo bill must not raise a warning about a real one, or the other way round:
      // the walkthrough runs on the same code and the same screens.
      if (other.isDemo !== subject.isDemo) continue

      const verdict = compare(subject, other)
      if (!verdict) continue

      matches.push({
        id: other.id,
        title: nameOf(other),
        strength: verdict.strength,
        why: verdict.why,
        state: stateOf(other),
      })
    }

    if (matches.length === 0) continue

    matches.sort((x, y) => {
      const byStrength = STRENGTH_ORDER[x.strength] - STRENGTH_ORDER[y.strength]
      if (byStrength !== 0) return byStrength
      // Then the dangerous one: a copy that has already been paid is the reason to look.
      return Number(y.state.startsWith('already')) - Number(x.state.startsWith('already'))
    })

    found.set(subject.id, matches)
  }

  return found
}
