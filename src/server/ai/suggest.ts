import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/server/db/client'
import { suggestDisposition, type FilterVerdict } from '@/server/action-filter'
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
  confidence: number
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
): Promise<{ ok: boolean; suggestion?: AiSuggestion; error?: string }> {
  if (!aiConfigured()) return { ok: false, error: 'AI reading is not configured' }

  const existing = await prisma.document.findFirst({
    where: { id: documentId, companyGroupId, deletedAt: null },
    select: { aiSuggestion: true, disposition: true },
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

  return { ok: true, suggestion }
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
  if (x.deadlineOrRisk.present && verdict.disposition === 'ARCHIVE') {
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
