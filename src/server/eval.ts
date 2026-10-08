/**
 * Scoring the reader against mail a person already decided.
 *
 * ---------------------------------------------------------------------------
 * What the set is, and why it is stated rather than assumed
 * ---------------------------------------------------------------------------
 *
 * Three different sets can all be called "the history", and they give three different
 * answers. Counted in this log today: 393 documents carry a human decision; 370 of those
 * also carry an entity; 370 (a different 370) have a stored file; and 347 have all
 * three. The decision can be scored on anything with a file and a decision, because the
 * decision is the answer key. The entity can only be scored where a person recorded one.
 *
 * So the two measurements use two denominators, and both are printed. A single
 * "accuracy" over one set that silently excluded 23 documents is the kind of number that
 * survives a meeting and is wrong.
 *
 * ---------------------------------------------------------------------------
 * The baseline, which is the whole reason the report is shaped this way
 * ---------------------------------------------------------------------------
 *
 * The decision is lopsided — around seven in ten documents were archived. A reader that
 * archived everything, read nothing and cost nothing scores about 72%. Every figure
 * here is therefore reported against that baseline, and the headline is a count of
 * missed actions rather than a percentage of anything.
 */

import { prisma } from '@/server/db/client'

/** Sonnet, per token. Only ever used for the estimate shown before a run starts. */
const PRICE = { input: 2 / 1_000_000, output: 10 / 1_000_000 }
/** Measured on a one-page scan of this group's own mail. */
const TYPICAL = { input: 1_850, output: 260 }

export const PILOT_SIZE = 10

export function estimateCost(documents: number) {
  return documents * (TYPICAL.input * PRICE.input + TYPICAL.output * PRICE.output)
}

export function costOf(inputTokens: number, outputTokens: number) {
  return inputTokens * PRICE.input + outputTokens * PRICE.output
}

/**
 * Documents the reader can be scored on: a stored file to read, and a decision a person
 * made to be scored against. The entity is *not* required here — it is required to score
 * the entity, which is a different question with a smaller denominator.
 */
export function evalWhere(companyGroupId: string) {
  return {
    companyGroupId,
    deletedAt: null,
    isDemo: false,
    storageKey: { not: null },
    disposition: { not: 'UNREVIEWED' },
  } as const
}

export type EvalSet = {
  /** Scorable for the decision. */
  total: number
  /** Of those, how many also carry an entity, and so can score the entity. */
  withEntity: number
  archive: number
  action: number
  /** What archiving everything unread would score, as a percentage of `total`. */
  baseline: number
  /** Documents whose action kind is PAY — the payment question's whole sample. */
  pay: number
}

export async function evalSet(companyGroupId: string): Promise<EvalSet> {
  const where = evalWhere(companyGroupId)
  const [total, withEntity, archive, action, pay] = await Promise.all([
    prisma.document.count({ where }),
    prisma.document.count({ where: { ...where, entityId: { not: null } } }),
    prisma.document.count({ where: { ...where, disposition: 'ARCHIVE' } }),
    prisma.document.count({ where: { ...where, disposition: 'ACTION' } }),
    prisma.document.count({ where: { ...where, actionKind: 'PAY' } }),
  ])
  return {
    total,
    withEntity,
    archive,
    action,
    baseline: total === 0 ? 0 : archive / total,
    pay,
  }
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

type Suggestion = {
  disposition?: string | null
  dispositionReason?: string | null
  actionKind?: string | null
  entityId?: string | null
  documentTypeId?: string | null
  confidence?: number | null
  decisionConfidence?: number | null
}

type Extraction = { entityCode?: string | null; addresseeName?: string | null }

export type Miss = {
  documentId: string
  filename: string
  truthActionKind: string | null
  modelReason: string | null
  decisionConfidence: number | null
}

export type Divergence = {
  documentId: string
  filename: string
  decision: { truth: string; model: string } | null
  entity: { truth: string; model: string } | null
  addresseeAsPrinted: string | null
}

export type EvalReport = {
  run: {
    id: string
    label: string
    model: string
    note: string | null
    startedAt: Date
    finishedAt: Date | null
    documentCount: number
    inputTokens: number
    outputTokens: number
  }
  scored: number
  unreadable: { filename: string; error: string }[]
  decision: {
    actionTruth: number
    actionCaught: number
    actionMissed: number
    archiveTruth: number
    archiveRaised: number
    baseline: number
    misses: Miss[]
  }
  payment: { truthPay: number; modelPay: number; agreed: number }
  entity: {
    /** Rows are the truth, columns what the model said. Counts, never percentages. */
    rows: { code: string; total: number; right: number; cells: Record<string, number> }[]
    columns: string[]
    scored: number
  }
  byType: { code: string; n: number; decisionRight: number; missedAction: number }[]
  divergences: Divergence[]
}

export async function buildReport(runId: string, companyGroupId: string): Promise<EvalReport | null> {
  const run = await prisma.aiEvalRun.findFirst({ where: { id: runId, companyGroupId } })
  if (!run) return null

  const [results, entities, types] = await Promise.all([
    prisma.aiEvalResult.findMany({
      where: { runId: run.id },
      include: { document: { select: { originalFilename: true, documentTypeId: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.entity.findMany({ where: { companyGroupId }, select: { id: true, code: true } }),
    prisma.documentType.findMany({ where: { companyGroupId }, select: { id: true, code: true } }),
  ])

  const codeOf = (id: string | null | undefined) =>
    id ? (entities.find((e) => e.id === id)?.code ?? '?') : '(none)'
  const typeOf = (id: string | null | undefined) =>
    id ? (types.find((t) => t.id === id)?.code ?? '?') : '(none)'

  const read = results.filter((r) => r.readError === null)
  const sug = (r: (typeof read)[number]) => (r.suggestion ?? {}) as Suggestion
  const ext = (r: (typeof read)[number]) => (r.extraction ?? {}) as Extraction

  // --- the decision ---------------------------------------------------------
  const actionTruth = read.filter((r) => r.truthDisposition === 'ACTION')
  const archiveTruth = read.filter((r) => r.truthDisposition === 'ARCHIVE')
  const missed = actionTruth.filter((r) => sug(r).disposition === 'ARCHIVE')
  const raised = archiveTruth.filter((r) => sug(r).disposition === 'ACTION')

  // --- payment --------------------------------------------------------------
  const truthPay = read.filter((r) => r.truthActionKind === 'PAY')
  const modelPay = read.filter((r) => sug(r).actionKind === 'PAY')

  // --- entity, only where a person recorded one -----------------------------
  const entityScored = read.filter((r) => r.truthEntityId !== null)
  const columns = [...new Set(entityScored.map((r) => ext(r).entityCode ?? '(none)'))].sort()
  const truthCodes = [...new Set(entityScored.map((r) => codeOf(r.truthEntityId)))].sort()
  const rows = truthCodes.map((code) => {
    const mine = entityScored.filter((r) => codeOf(r.truthEntityId) === code)
    const cells: Record<string, number> = {}
    for (const col of columns) {
      cells[col] = mine.filter((r) => (ext(r).entityCode ?? '(none)') === col).length
    }
    return { code, total: mine.length, right: cells[code] ?? 0, cells }
  })

  // --- by document type -----------------------------------------------------
  const typeMap = new Map<string, { n: number; decisionRight: number; missedAction: number }>()
  for (const r of read) {
    const key = typeOf(r.document.documentTypeId)
    const row = typeMap.get(key) ?? { n: 0, decisionRight: 0, missedAction: 0 }
    row.n += 1
    if (sug(r).disposition === r.truthDisposition) row.decisionRight += 1
    if (r.truthDisposition === 'ACTION' && sug(r).disposition === 'ARCHIVE') row.missedAction += 1
    typeMap.set(key, row)
  }

  // --- divergences ----------------------------------------------------------
  const divergences: Divergence[] = []
  for (const r of read) {
    const decisionDiffers = sug(r).disposition !== r.truthDisposition
    const truthCode = codeOf(r.truthEntityId)
    const modelCode = ext(r).entityCode ?? '—'
    // Only a real disagreement: no entity on either side is not one.
    const entityDiffers = r.truthEntityId !== null && modelCode !== truthCode
    if (!decisionDiffers && !entityDiffers) continue
    divergences.push({
      documentId: r.documentId,
      filename: r.document.originalFilename,
      decision: decisionDiffers
        ? { truth: r.truthDisposition, model: sug(r).disposition ?? '—' }
        : null,
      entity: entityDiffers ? { truth: truthCode, model: modelCode } : null,
      addresseeAsPrinted: ext(r).addresseeName ?? null,
    })
  }

  return {
    run: {
      id: run.id,
      label: run.label,
      model: run.model,
      note: run.note,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      documentCount: run.documentCount,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
    },
    scored: read.length,
    unreadable: results
      .filter((r) => r.readError !== null)
      .map((r) => ({ filename: r.document.originalFilename, error: r.readError ?? '' })),
    decision: {
      actionTruth: actionTruth.length,
      actionCaught: actionTruth.length - missed.length,
      actionMissed: missed.length,
      archiveTruth: archiveTruth.length,
      archiveRaised: raised.length,
      baseline: read.length === 0 ? 0 : archiveTruth.length / read.length,
      misses: missed.map((r) => ({
        documentId: r.documentId,
        filename: r.document.originalFilename,
        truthActionKind: r.truthActionKind,
        modelReason: sug(r).dispositionReason ?? null,
        decisionConfidence: sug(r).decisionConfidence ?? null,
      })),
    },
    payment: {
      truthPay: truthPay.length,
      modelPay: modelPay.length,
      agreed: truthPay.filter((r) => sug(r).actionKind === 'PAY').length,
    },
    entity: { rows, columns, scored: entityScored.length },
    byType: [...typeMap]
      .map(([code, row]) => ({ code, ...row }))
      .sort((a, b) => b.n - a.n),
    divergences,
  }
}

/** Runs to choose from, newest first. */
export async function listRuns(companyGroupId: string) {
  return prisma.aiEvalRun.findMany({
    where: { companyGroupId },
    orderBy: { startedAt: 'desc' },
    take: 20,
    select: {
      id: true,
      label: true,
      startedAt: true,
      finishedAt: true,
      documentCount: true,
      inputTokens: true,
      outputTokens: true,
      _count: { select: { results: true } },
    },
  })
}

/**
 * Whether a pilot has actually been read.
 *
 * The full set stays locked until one has: ten documents cost six cents and answer the
 * two questions that matter before spending the rest — whether the reader can reach the
 * files at all, and what a page really costs here.
 */
export async function pilotDone(companyGroupId: string) {
  const run = await prisma.aiEvalRun.findFirst({
    where: { companyGroupId, results: { some: { readError: null } } },
    select: { id: true },
  })
  return run !== null
}
