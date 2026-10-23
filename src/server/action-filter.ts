import type { Prisma } from '@/generated/prisma/client'
import type { Disposition, DispositionReason } from '@/generated/prisma/enums'
import { prisma } from '@/server/db/client'

/**
 * The action filter — the core business rule of the platform.
 *
 * For every document the question is: archive it (no human decision needed), or send
 * it for action? This module answers that as a *suggestion* only. Nothing here commits
 * anything; a human always confirms on the classify screen.
 *
 * The one rule that must never be loosened: when the inputs are ambiguous, the answer
 * is ACTION. Silently archiving something that turns out to carry a deadline is the
 * failure mode this whole platform exists to prevent. Archiving is only ever suggested
 * when a positive, stated reason applies.
 */

export type FilterVerdict = {
  disposition: Disposition
  reason: DispositionReason | null
  /** Shown to the operator next to the suggestion, so the call is never a black box. */
  rationale: string
  /**
   * True when something about this document did not line up cleanly. The classify
   * screen highlights these — they are exactly the cases worth a second look.
   */
  ambiguous: boolean
}

export type FilterInput = {
  companyGroupId: string
  entityId: string | null
  documentTypeId: string | null
  vendorId: string | null
  /** Date the autopay rule is evaluated against — the document's own date, not today. */
  onDate?: Date
  /**
   * Whether the page actually asks for money.
   *
   * A card statement is typed Statement, which files by default — but one showing a
   * balance due is a bill, and the question that matters for it is whether the payment
   * is automatic. Without this the autopay list is never consulted for it.
   */
  owesMoney?: boolean
  /**
   * What the page says is due, when it says anything.
   *
   * Needed because confirmed autopay and a large amount are different questions. An
   * arrangement says "this will be paid without anybody doing it"; it does not say "and
   * nobody needs to see it". Eric wants an approval on a five-thousand-dollar payment
   * and none on a fifteen-dollar subscription, and the amount is the only thing that
   * tells those apart.
   */
  amount?: number | null
}

/**
 * Finds the autopay rule covering this vendor+entity on a given date.
 *
 * Rules are keyed on vendor AND entity: one entity may autopay a utility while a
 * sibling entity pays the same utility manually. They are also time-bounded, so
 * re-opening a document filed last year shows what was true when it was filed rather
 * than what is true now.
 */
export async function findAutopayRule(
  vendorId: string,
  entityId: string,
  onDate: Date = new Date(),
) {
  return prisma.autopayRule.findFirst({
    where: {
      vendorId,
      entityId,
      effectiveFrom: { lte: onDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: onDate } }],
    },
    include: { entity: { select: { code: true } }, vendor: { select: { name: true } } },
  })
}

/**
 * Autopay rules for this vendor on *other* entities. This is the ambiguity that matters
 * most in practice: the vendor is familiar and clearly on autopay somewhere, which is
 * exactly what makes it tempting to wave through — but the bill in hand belongs to an
 * entity that pays manually.
 */
async function findAutopayOnOtherEntities(vendorId: string, entityId: string, onDate: Date) {
  return prisma.autopayRule.findMany({
    where: {
      vendorId,
      entityId: { not: entityId },
      effectiveFrom: { lte: onDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: onDate } }],
    },
    include: { entity: { select: { code: true } } },
  })
}

/** Reasons for the archive-by-default types, so the audit record says something useful. */
const ARCHIVE_REASON_BY_CODE: Record<string, { reason: DispositionReason; rationale: string }> = {
  CHECK: {
    reason: 'INCOMING_CHECK',
    rationale: 'Incoming third-party check. Log and file, no action.',
  },
  STATEMENT: {
    reason: 'FYI_STATEMENT',
    rationale: 'Statement / FYI notice with nothing to decide.',
  },
  SPAM: {
    reason: 'SPAM_SOLICITATION',
    rationale: 'Solicitation disguised as an official notice. Log and file, no action.',
  },
}

export async function suggestDisposition(input: FilterInput): Promise<FilterVerdict> {
  const onDate = input.onDate ?? new Date()

  const [documentType, vendor] = await Promise.all([
    input.documentTypeId
      ? prisma.documentType.findUnique({ where: { id: input.documentTypeId } })
      : null,
    input.vendorId ? prisma.vendor.findUnique({ where: { id: input.vendorId } }) : null,
  ])

  // Not enough information yet — the operator is still filling the form.
  if (!documentType) {
    return {
      disposition: 'UNREVIEWED',
      reason: null,
      rationale: 'Pick a document type to get a suggestion.',
      ambiguous: false,
    }
  }

  // Solicitations disguised as official notices. These self-disclose in fine print
  // ("this is not a bill", "not affiliated with any government agency") and are
  // recognised by vendor, since the same handful of outfits mail them repeatedly.
  if (vendor?.knownSpam) {
    return {
      disposition: 'ARCHIVE',
      reason: 'SPAM_SOLICITATION',
      rationale: `${vendor.name} is flagged as a solicitation mill. Log and file, no action.`,
      ambiguous: false,
    }
  }

  // Deadline-bearing government notices. Never archived automatically however small the
  // amount — the cost of missing one is a penalty, not the dollar value on the page.
  if (documentType.defaultAction === 'ACTION') {
    return {
      disposition: 'ACTION',
      reason: 'DEADLINE_NOTICE',
      rationale: `${documentType.label} carries a deadline. Always goes to a human.`,
      ambiguous: false,
    }
  }

  // Types configured to archive outright. Driven by `defaultAction` rather than a list
  // of hardcoded codes, so a group that adds its own archive-by-default type is covered
  // without a code change.
  // A type that files by default still files by default — unless this particular
  // document is asking to be paid, in which case the autopay list decides.
  if (documentType.defaultAction === 'ARCHIVE' && !input.owesMoney) {
    const known = ARCHIVE_REASON_BY_CODE[documentType.code]
    return {
      disposition: 'ARCHIVE',
      reason: known?.reason ?? 'OTHER',
      rationale: known?.rationale ?? `${documentType.label} is archived by default. Log and file.`,
      ambiguous: false,
    }
  }

  // Bills and insurance: the answer depends entirely on the autopay lookup.
  if (!input.entityId || !vendor) {
    return {
      disposition: 'UNREVIEWED',
      reason: null,
      rationale: 'Set the entity and vendor to check the autopay list.',
      ambiguous: false,
    }
  }

  const rule = await findAutopayRule(vendor.id, input.entityId, onDate)
  if (rule) {
    // An arrangement that covers only part of the bill is not a reason to archive it.
    // The automatic half is handled; the rest is still somebody's job, and filing the
    // document away is how that half goes unpaid.
    if (!rule.coversFullBalance) {
      return {
        disposition: 'ACTION',
        reason: 'MANUAL_INVOICE',
        rationale:
          `${vendor.name} is on PARTIAL autopay for ${rule.entity.code} — the automatic ` +
          `payment does not settle the whole balance, so the rest still needs paying.` +
          (rule.notes ? ` Noted: ${rule.notes}` : ''),
        ambiguous: true,
      }
    }

    /*
     * Big enough that somebody should still see it.
     *
     * The rule's own ceiling wins when it has one — an arrangement whose amounts are
     * known to be large and routine can be allowed to run higher, and one that should
     * never pass unseen can be held lower. Otherwise the group's ceiling applies.
     *
     * A bill with no amount is not held back: there is nothing to compare, and holding
     * every unpriced autopay document would reinstate exactly the approval queue this
     * exists to empty.
     */
    const ceiling = await autopayCeiling(input.companyGroupId, rule.ceiling)
    if (ceiling !== null && input.amount !== null && input.amount !== undefined && input.amount > ceiling) {
      return {
        disposition: 'ACTION',
        reason: 'MANUAL_INVOICE',
        rationale:
          `${vendor.name} is on confirmed autopay for ${rule.entity.code}, but ` +
          `${money(input.amount)} is over the ${money(ceiling)} ceiling — it still needs an ` +
          `approver. The payment itself is automatic either way.`,
        ambiguous: false,
      }
    }

    return {
      disposition: 'ARCHIVE',
      reason: 'AUTOPAY',
      rationale: `${vendor.name} is on confirmed autopay for ${rule.entity.code}. Log and file.`,
      ambiguous: false,
    }
  }

  const elsewhere = await findAutopayOnOtherEntities(vendor.id, input.entityId, onDate)
  if (elsewhere.length > 0) {
    const codes = elsewhere.map((r) => r.entity.code).join(', ')
    return {
      disposition: 'ACTION',
      reason: 'MANUAL_INVOICE',
      rationale:
        `${vendor.name} is on autopay for ${codes} — but not for this entity. ` +
        `Confirm before assuming it is already paid.`,
      ambiguous: true,
    }
  }

  return {
    disposition: 'ACTION',
    reason: 'MANUAL_INVOICE',
    rationale: `${vendor.name} is not on the autopay list for this entity.`,
    ambiguous: false,
  }
}

/** US dollars, for a sentence a person reads. */
function money(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n)
}

/** The group's default, which a rule may override. Null disables the ceiling entirely. */
export const DEFAULT_AUTOPAY_CEILING = 1000

export async function autopayCeiling(
  companyGroupId: string,
  ruleCeiling?: Prisma.Decimal | null,
): Promise<number | null> {
  if (ruleCeiling !== null && ruleCeiling !== undefined) return Number(ruleCeiling.toString())

  const group = await prisma.companyGroup.findUnique({
    where: { id: companyGroupId },
    select: { settings: true },
  })
  const settings = (group?.settings ?? {}) as Record<string, unknown>
  const raw = settings.autopayCeiling

  // Explicitly off, rather than unset: somebody chose to let autopay settle anything.
  if (raw === null) return null
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw
  return DEFAULT_AUTOPAY_CEILING
}
