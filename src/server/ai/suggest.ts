import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/server/db/client'
import { suggestDisposition, type FilterVerdict } from '@/server/action-filter'
import { recordEvent } from '@/server/documents'
import { suggestFilename } from '@/server/filename'
import { readDocument, aiConfigured } from '@/server/ai/read-document'
import type { Extraction } from '@/server/ai/schema'

/**
 * Turns a reading of a document into a filled-in classification proposal.
 *
 * The division of labour matters. The model reports what the page says; the
 * deterministic action filter decides what to do about it, because whether a bill is on
 * autopay is a lookup against the company's own records and must be exact rather than
 * inferred. The model contributes only the two judgements the filter cannot make from
 * the database — whether this is a solicitation, and whether it carries a deadline or
 * risk — and it contributes them as evidence, not as a verdict.
 *
 * Nothing here writes a classification. The result is stored on the document as a
 * suggestion and arrives on the classify screen pre-filled and editable.
 */

export type AiSuggestion = {
  entityId: string | null
  documentTypeId: string | null
  vendorId: string | null
  vendorName: string | null
  amount: number | null
  documentDate: string | null
  dueDate: string | null
  summary: string
  disposition: FilterVerdict['disposition']
  dispositionReason: FilterVerdict['reason']
  rationale: string
  ambiguous: boolean
  /** How sure the model is about what it READ off the page. */
  confidence: number
  /**
   * How sure the system is about the DECISION, which is a different question.
   *
   * The personal auto-insurance renewal that started this was extracted at 93% — the
   * reading was excellent. What was unknown was whose document it is. Showing the
   * extraction number next to a decision invited exactly the wrong conclusion, and
   * would have been a disastrous thing to auto-apply on.
   */
  decisionConfidence: number
  /** Whether this may be decided without a person looking at it. */
  autoApplicable: boolean
  /** Kept for audit and for judging the model later against what a human chose. */
  raw: Extraction
  readAt: string
}

/** A vendor the model named, matched to an existing record or created. */
async function resolveVendor(companyGroupId: string, name: string | null) {
  const trimmed = name?.trim()
  if (!trimmed) return null

  const existing = await prisma.vendor.findFirst({
    where: { companyGroupId, name: { equals: trimmed, mode: 'insensitive' } },
    select: { id: true, name: true },
  })
  if (existing) return existing

  // Same biller, different spelling on the page — "Berkheimer" vs "Berkheimer Tax
  // Innovations". The trigram index makes this cheap, and reusing the record is what
  // keeps autopay rules attached to it working.
  const near = await prisma.$queryRaw<{ id: string; name: string }[]>`
    SELECT id, name FROM "vendor"
    WHERE company_group_id = ${companyGroupId}
      AND similarity(name, ${trimmed}) > 0.55
    ORDER BY similarity(name, ${trimmed}) DESC
    LIMIT 1
  `
  if (near[0]) return near[0]

  return prisma.vendor.create({
    data: { companyGroupId, name: trimmed },
    select: { id: true, name: true },
  })
}

function parseDate(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const d = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Reads a document and builds the proposal, storing it on the record.
 *
 * Idempotent by default: a document that already carries a suggestion is not read
 * again, because every read costs money and hundreds of these run during an import.
 */
export async function analyzeDocument(
  companyGroupId: string,
  documentId: string,
  opts: { force?: boolean } = {},
): Promise<{ ok: boolean; suggestion?: AiSuggestion; error?: string; applied?: boolean }> {
  if (!aiConfigured()) return { ok: false, error: 'AI reading is not configured' }

  const existing = await prisma.document.findFirst({
    where: { id: documentId, companyGroupId, deletedAt: null },
    select: { aiSuggestion: true, disposition: true, entityId: true, reviewedAt: true },
  })
  if (!existing) return { ok: false, error: 'Document not found' }
  if (existing.aiSuggestion && !opts.force) {
    return { ok: true, suggestion: existing.aiSuggestion as unknown as AiSuggestion }
  }

  const read = await readDocument(companyGroupId, documentId)
  if (!read.ok) return { ok: false, error: read.error }

  const x = read.extraction

  const [entity, documentType, vendor] = await Promise.all([
    x.entityCode
      ? prisma.entity.findFirst({
          where: { companyGroupId, code: x.entityCode, isActive: true },
          select: { id: true },
        })
      : null,
    x.documentTypeCode
      ? prisma.documentType.findFirst({
          where: { companyGroupId, code: x.documentTypeCode, isActive: true },
          select: { id: true },
        })
      : null,
    resolveVendor(companyGroupId, x.vendorName),
  ])

  const documentDate = parseDate(x.documentDate)

  // The autopay question is answered here, against the company's records, evaluated on
  // the document's own date rather than today — so a bill from March is judged by the
  // rules that were in force in March.
  const verdict = await suggestDisposition({
    companyGroupId,
    entityId: entity?.id ?? null,
    documentTypeId: documentType?.id ?? null,
    vendorId: vendor?.id ?? null,
    onDate: documentDate ?? undefined,
  })

  const merged = mergeVerdict(verdict, x)

  const suggestion: AiSuggestion = {
    entityId: entity?.id ?? null,
    documentTypeId: documentType?.id ?? null,
    vendorId: vendor?.id ?? null,
    vendorName: vendor?.name ?? x.vendorName,
    amount: x.amount,
    documentDate: x.documentDate,
    dueDate: x.dueDate,
    summary: x.summary,
    ...merged,
    confidence: x.confidence,
    ...scoreDecision(x, merged, {
      entityMatched: Boolean(entity),
      typeMatched: Boolean(documentType),
    }),
    raw: x,
    readAt: new Date().toISOString(),
  }

  await prisma.document.update({
    where: { id: documentId },
    data: {
      aiSuggestion: suggestion as unknown as Prisma.InputJsonValue,
      aiConfidence: x.confidence,
    },
  })

  await adoptEntityFromDocument(documentId, existing, entity?.id ?? null, x)

  const applied = suggestion.autoApplicable
    ? await applyDecision(companyGroupId, documentId, suggestion)
    : false

  return { ok: true, suggestion, applied }
}

/**
 * Combines what the filter concluded from the company's records with what the model saw
 * on the page.
 *
 * The precedence is deliberate. A stated deadline or a stated risk overrides any
 * suggestion to archive, however confident the filter was — missing one of those is the
 * failure this platform exists to prevent, and its cost is a penalty rather than the
 * amount printed on the page. A solicitation is only ever a suggestion to archive when
 * the model can quote the disclaimer that proves it.
 */
export function mergeVerdict(
  verdict: FilterVerdict,
  x: Extraction,
): Pick<AiSuggestion, 'disposition' | 'dispositionReason' | 'rationale' | 'ambiguous'> {
  // Money arriving carries no obligation. A "void if not deposited in 90 days" note on
  // an incoming check is not a deadline this company has to meet, and letting it
  // override the archive turned received cheques into things to pay.
  const moneyIn = x.moneyDirection === 'received_by_us' || verdict.reason === 'INCOMING_CHECK'

  if (x.deadlineOrRisk.present && !moneyIn && verdict.disposition === 'ARCHIVE') {
    return {
      disposition: 'ACTION',
      dispositionReason: 'DEADLINE_NOTICE',
      rationale: `Filing rules pointed at archive, but the document states a deadline or consequence: ${x.deadlineOrRisk.detail ?? 'see the page'}. Surfacing it instead.`,
      ambiguous: true,
    }
  }

  if (x.solicitation.isSolicitation && x.solicitation.evidence) {
    return {
      disposition: 'ARCHIVE',
      dispositionReason: 'SPAM_SOLICITATION',
      rationale: `Reads as a solicitation, not a bill — the page says: "${x.solicitation.evidence}". Log and file, no action.`,
      ambiguous: false,
    }
  }

  // A filing rule that reached a definite archive knows more than the generic test
  // below — autopay and incoming cheques carry better reasons than "nothing to do".
  if (verdict.disposition === 'ARCHIVE') {
    return {
      disposition: 'ARCHIVE',
      dispositionReason: verdict.reason,
      rationale: verdict.rationale,
      ambiguous: verdict.ambiguous,
    }
  }

  /**
   * Purely informational mail: nothing owed, no deadline, no stated consequence.
   *
   * This is a large share of a real month — transfer confirmations, statements, lender
   * rate sheets, a vendor's contact card — and it was the worst-handled. The autopay
   * lookup was being asked of all of it, because the type falls through to ASK, and
   * "not on the autopay list" came back as though a rate sheet were an unpaid bill.
   * That question only means something for a document that asks for money. When none
   * of the three signals of an obligation is present, there is nothing to decide, and
   * saying so is a confident answer rather than a doubt.
   */
  const asksForNothing =
    x.moneyDirection !== 'owed_by_us' &&
    x.amount === null &&
    !x.dueDate &&
    !x.deadlineOrRisk.present

  if (asksForNothing) {
    return {
      disposition: 'ARCHIVE',
      dispositionReason: 'FYI_STATEMENT',
      rationale: `Nothing owed, no deadline and no stated risk${
        x.vendorName ? ` — informational mail from ${x.vendorName}` : ''
      }. Log and file, no action.`,
      ambiguous: false,
    }
  }

  // Addressed to somebody outside the group. That is an answer, not a failure to read,
  // and it is a question only a person can settle: is this personal, or a company
  // record filed under a name we have not registered yet?
  if (!x.entityCode && x.addresseeName) {
    return {
      disposition: 'ACTION',
      dispositionReason: null,
      rationale: `Addressed to "${x.addresseeName}", which matches none of the entities. Confirm whether this is company mail before anything is done with it.`,
      ambiguous: true,
    }
  }

  // The filter has nothing to say until a type is known; the model usually supplies one,
  // so this is the case where it could not.
  if (verdict.disposition === 'UNREVIEWED') {
    return {
      disposition: 'ACTION',
      dispositionReason: null,
      rationale: x.deadlineOrRisk.present
        ? `Could not classify this confidently, and it states a deadline: ${x.deadlineOrRisk.detail ?? 'see the page'}.`
        : 'Could not classify this confidently. Ambiguity goes to a human.',
      ambiguous: true,
    }
  }

  return {
    disposition: verdict.disposition,
    dispositionReason: verdict.reason,
    rationale: verdict.rationale,
    ambiguous: verdict.ambiguous,
  }
}

/** Below this, a decision is never applied without a person seeing it. */
export const AUTO_APPLY_THRESHOLD = 0.85

/**
 * Scores the decision rather than the reading, and says whether it may stand on its own.
 *
 * Every condition here is a veto, not a weight. A decision is applied automatically only
 * when the reading was clear, the filing rules produced a stated reason, and there is no
 * open question about whose document this is — so an unresolved doubt can never be
 * outvoted by confidence elsewhere.
 */
function scoreDecision(
  x: Extraction,
  merged: Pick<AiSuggestion, 'disposition' | 'dispositionReason' | 'ambiguous'>,
  matched: { entityMatched: boolean; typeMatched: boolean },
): { decisionConfidence: number; autoApplicable: boolean } {
  const blockers: boolean[] = [
    // Anything the merge flagged is by definition a question for a person.
    merged.ambiguous,
    // Not knowing whose document this is blocks every decision about it.
    !matched.entityMatched,
    !matched.typeMatched,
    // A disposition with no stated reason cannot be audited later, which is the whole
    // point of the archive-needs-a-reason rule.
    !merged.dispositionReason,
    // A poor scan the model itself doubted.
    x.confidence < AUTO_APPLY_THRESHOLD,
  ]

  const blocked = blockers.filter(Boolean).length
  if (blocked === 0) {
    return { decisionConfidence: x.confidence, autoApplicable: true }
  }

  // Each unmet condition drops the decision a clear step below the bar, so the number
  // shown to a person reflects the doubt rather than the quality of the reading.
  const penalty = Math.min(0.75, 0.25 * blocked)
  return {
    decisionConfidence: Math.max(0.05, Math.round((x.confidence - penalty) * 100) / 100),
    autoApplicable: false,
  }
}

/**
 * Writes a decision the reader was sure about, without waiting for a click.
 *
 * This is the part that turns reading into work saved. It only ever runs on a
 * suggestion that cleared every condition in scoreDecision, and only when the group has
 * turned it on — a reader that decides on its own is a different product from one that
 * proposes, and that is the owner's call to make, not a default.
 *
 * Nothing is hidden and nothing is lost. The decision lands on the document exactly as a
 * person's would, and a DocumentEvent records that the reader made it, with the reasoning
 * and both confidence figures, so any of it can be audited or reversed later.
 */
async function applyDecision(
  companyGroupId: string,
  documentId: string,
  suggestion: AiSuggestion,
): Promise<boolean> {
  const [group, entity, type, doc] = await Promise.all([
    prisma.companyGroup.findUnique({ where: { id: companyGroupId }, select: { settings: true } }),
    suggestion.entityId
      ? prisma.entity.findUnique({ where: { id: suggestion.entityId }, select: { code: true } })
      : null,
    suggestion.documentTypeId
      ? prisma.documentType.findUnique({ where: { id: suggestion.documentTypeId }, select: { label: true } })
      : null,
    prisma.document.findUnique({
      where: { id: documentId },
      select: {
        disposition: true,
        originalFilename: true,
        documentDate: true,
        dueDate: true,
        amount: true,
      },
    }),
  ])

  // Never overwrite a decision a person already made.
  if (!doc || doc.disposition !== 'UNREVIEWED') return false

  const settings = (group?.settings as Record<string, unknown> | null) ?? {}
  if (settings.autoApply !== true) return false

  // The page wins, but a value already on the record does not get thrown away. The
  // filename parser pulls a date off the scan's name at upload, and plenty of documents
  // — statements especially — show a period rather than a date of issue.
  const documentDate = suggestion.documentDate
    ? new Date(`${suggestion.documentDate}T00:00:00Z`)
    : doc.documentDate
  const dueDate = suggestion.dueDate ? new Date(`${suggestion.dueDate}T00:00:00Z`) : doc.dueDate
  const amount = suggestion.amount ?? (doc.amount == null ? null : Number(String(doc.amount)))

  const finalFilename = suggestFilename(
    {
      entityCode: entity?.code ?? null,
      documentDate,
      typeLabel: type?.label ?? null,
      amount,
      extension: doc.originalFilename.split('.').pop() ?? 'pdf',
    },
    settings as { filenameTemplate?: string; dateFormat?: string },
  )

  const isAction = suggestion.disposition === 'ACTION'

  await prisma.$transaction(async (tx) => {
    await tx.document.update({
      where: { id: documentId },
      data: {
        entityId: suggestion.entityId,
        documentTypeId: suggestion.documentTypeId,
        vendorId: suggestion.vendorId,
        documentDate,
        dueDate,
        amount: amount == null ? null : new Prisma.Decimal(amount),
        disposition: suggestion.disposition,
        dispositionReason: suggestion.dispositionReason,
        // An action item has to say what it asks for; REVIEW is the honest default when
        // the reader was not told to route it anywhere in particular.
        actionKind: isAction ? 'REVIEW' : null,
        status: isAction ? 'WAITING' : 'ARCHIVED',
        summaryNote: suggestion.summary,
        finalFilename,
        reviewedAt: new Date(),
      },
    })

    await recordEvent(
      {
        documentId,
        // Null actor: this was not a person, and the log should not imply one.
        actorUserId: null,
        action: 'classified',
        fromValue: { disposition: 'UNREVIEWED' },
        toValue: {
          disposition: suggestion.disposition,
          dispositionReason: suggestion.dispositionReason,
          rationale: suggestion.rationale,
          decisionConfidence: suggestion.decisionConfidence,
          extractionConfidence: suggestion.confidence,
          via: 'auto-reader',
        },
      },
      tx,
    )
  })

  return true
}

/** Whether this group lets the reader decide on its own. */
export async function autoApplyEnabled(companyGroupId: string) {
  const group = await prisma.companyGroup.findUnique({
    where: { id: companyGroupId },
    select: { settings: true },
  })
  return ((group?.settings as Record<string, unknown> | null) ?? {}).autoApply === true
}

/**
 * Files the document under the entity the page names, rather than the one its filename
 * claimed.
 *
 * A scan's name is informal and often inherited from however it was handled before:
 * `CP_07-13-26_CAEDD_FormDelinquency.pdf` was addressed, in its body, to CO/LAB OPS
 * PERFECTION, LLC. The filename parser sets an entity at upload from that prefix, the
 * reader then reads the addressee off the page, and until now only the filename's guess
 * reached the record — so the review screen grouped the document under the wrong company
 * and a quick archive would have filed it there permanently.
 *
 * The body wins, because it is the document. This only ever moves a document nobody has
 * reviewed, never one a person has already placed, and the change is recorded with both
 * values so a wrong move is visible and reversible.
 */
async function adoptEntityFromDocument(
  documentId: string,
  before: { entityId: string | null; disposition: string; reviewedAt: Date | null },
  readEntityId: string | null,
  x: Extraction,
) {
  if (!readEntityId || readEntityId === before.entityId) return
  // A person has looked at this and placed it. Their answer stands.
  if (before.disposition !== 'UNREVIEWED' || before.reviewedAt) return

  await prisma.$transaction(async (tx) => {
    await tx.document.update({
      where: { id: documentId },
      data: { entityId: readEntityId },
    })
    await recordEvent(
      {
        documentId,
        actorUserId: null,
        action: 'reclassified',
        fromValue: { entityId: before.entityId, source: 'filename' },
        toValue: {
          entityId: readEntityId,
          source: 'document body',
          addressee: x.addresseeName,
          via: 'auto-reader',
        },
      },
      tx,
    )
  })
}
