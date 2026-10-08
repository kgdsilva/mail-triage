import 'dotenv/config'
import { requireSafeTarget } from './db-target'
import { prisma } from '../src/server/db/client'

/**
 * Reads one evaluation run and says what it means.
 *
 * ---------------------------------------------------------------------------
 * Why there is no "accuracy" line
 * ---------------------------------------------------------------------------
 *
 * In this log 274 of 370 decided documents are ARCHIVE. A reader that archived
 * everything, read nothing and cost nothing would score 74%, so an overall accuracy
 * figure is mostly a measure of how lopsided the set is. It would go up when the
 * reader got worse at the only thing that matters.
 *
 * So the headline here is a single count: **how many documents a person sent to action
 * and the pipeline would have archived.** That is the missed deadline, the notice nobody
 * saw — the failure this platform exists to prevent. The opposite error costs thirty
 * seconds in Review and is reported separately, smaller.
 *
 * The entity figures are counts for the same reason. OP has 27 documents and MMT has
 * 16, so one document is six percentage points there; a percentage would read as
 * precision and be noise. The confusion matrix is printed in documents, not percent.
 *
 * Divergence is not error. The spreadsheet this history came from has mistakes of its
 * own — the import found several — so the last section is a list to be read by a
 * person, naming both answers and judging neither.
 *
 *   tsx scripts/ai-eval-report.ts --run=<id>     (omit --run for the latest)
 */

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

function arg(name: string) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}

function pct(n: number, of: number) {
  return of === 0 ? '—' : `${Math.round((n / of) * 100)}%`
}

function bar(label: string) {
  console.log(`\n${label}\n${'─'.repeat(label.length)}`)
}

async function main() {
  requireSafeTarget('read an AI evaluation report')

  const runId = arg('run')
  const run = runId
    ? await prisma.aiEvalRun.findUniqueOrThrow({ where: { id: runId } })
    : await prisma.aiEvalRun.findFirstOrThrow({ orderBy: { startedAt: 'desc' } })

  const results = await prisma.aiEvalResult.findMany({
    where: { runId: run.id },
    include: { document: { select: { originalFilename: true, documentTypeId: true } } },
  })

  const entities = await prisma.entity.findMany({ select: { id: true, code: true } })
  const types = await prisma.documentType.findMany({ select: { id: true, code: true, label: true } })
  const codeOf = (id: string | null | undefined) =>
    id ? (entities.find((e) => e.id === id)?.code ?? '?') : '(none)'
  const typeOf = (id: string | null | undefined) =>
    id ? (types.find((t) => t.id === id)?.code ?? '?') : '(none)'

  const read = results.filter((r) => r.readError === null)
  const unread = results.filter((r) => r.readError !== null)

  bar(`Run: ${run.label}`)
  console.log(`id        ${run.id}`)
  console.log(`model     ${run.model}`)
  console.log(`started   ${run.startedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`)
  if (run.note) console.log(`note      ${run.note}`)
  console.log(`documents ${results.length}  (${read.length} read, ${unread.length} unreadable)`)
  console.log(`tokens    ${run.inputTokens} in / ${run.outputTokens} out`)

  // -------------------------------------------------------------------------
  // 1. The number that matters.
  // -------------------------------------------------------------------------
  const truthAction = read.filter((r) => r.truthDisposition === 'ACTION')
  const truthArchive = read.filter((r) => r.truthDisposition === 'ARCHIVE')
  const missed = truthAction.filter((r) => (r.suggestion as Suggestion)?.disposition === 'ARCHIVE')
  const overCalled = truthArchive.filter(
    (r) => (r.suggestion as Suggestion)?.disposition === 'ACTION',
  )

  bar('1. Action recall — the only figure with teeth')
  console.log(`of ${truthAction.length} documents a person sent to ACTION,`)
  console.log(`  caught   ${truthAction.length - missed.length}`)
  console.log(`  MISSED   ${missed.length}   ← each one is a notice nobody would have seen`)
  console.log(`  recall   ${pct(truthAction.length - missed.length, truthAction.length)}`)
  console.log(`\nof ${truthArchive.length} a person archived, ${overCalled.length} were raised to ACTION`)
  console.log(`  (the cheap error: thirty seconds in Review)`)
  console.log(
    `\nfor scale, archiving everything unread would have scored ${pct(truthArchive.length, read.length)} "accuracy"`,
  )

  if (missed.length > 0) {
    bar('1a. Every ACTION the pipeline would have archived')
    for (const r of missed) {
      const s = r.suggestion as Suggestion
      console.log(`  ${r.document.originalFilename}`)
      console.log(
        `      truth ACTION/${r.truthActionKind ?? '—'}   model ARCHIVE/${s?.dispositionReason ?? '—'}   conf ${s?.decisionConfidence ?? '—'}`,
      )
    }
  }

  // -------------------------------------------------------------------------
  // 2. Does it advance to payment or not.
  // -------------------------------------------------------------------------
  const truthPay = read.filter((r) => r.truthActionKind === 'PAY')
  const saidPay = read.filter((r) => (r.suggestion as Suggestion)?.actionKind === 'PAY')
  const payHit = truthPay.filter((r) => (r.suggestion as Suggestion)?.actionKind === 'PAY')

  bar('2. Advances to payment')
  console.log(`truth says pay   ${truthPay.length}`)
  console.log(`model says pay   ${saidPay.length}`)
  console.log(`agreed           ${payHit.length}`)
  console.log(`missed a payment ${truthPay.length - payHit.length}`)
  console.log(`invented one     ${saidPay.length - payHit.length}`)

  // -------------------------------------------------------------------------
  // 3. Entity, in documents.
  // -------------------------------------------------------------------------
  bar('3. Entity confusion, in documents (rows = truth, columns = model)')
  const codes = [...new Set(read.map((r) => codeOf(r.truthEntityId)))].sort()
  const guessed = [
    ...new Set(read.map((r) => (r.extraction as Extraction)?.entityCode ?? '(none)')),
  ].sort()
  const width = Math.max(8, ...guessed.map((c) => c.length + 2))

  console.log(`${'truth'.padEnd(10)}${guessed.map((c) => c.padStart(width)).join('')}${'  total'}`)
  for (const code of codes) {
    const rows = read.filter((r) => codeOf(r.truthEntityId) === code)
    const cells = guessed.map((g) => {
      const n = rows.filter((r) => ((r.extraction as Extraction)?.entityCode ?? '(none)') === g).length
      return (n === 0 ? '·' : String(n)).padStart(width)
    })
    const right = rows.filter((r) => (r.extraction as Extraction)?.entityCode === code).length
    console.log(`${code.padEnd(10)}${cells.join('')}${String(rows.length).padStart(7)}   ${right}/${rows.length} right`)
  }
  console.log('\nThe cells to read are CP↔OP and MM↔MMT. With 27 OP and 16 MMT in the set,')
  console.log('one document is six points — so treat anything under ~4 as noise.')

  // -------------------------------------------------------------------------
  // 4. By category.
  // -------------------------------------------------------------------------
  bar('4. By document type')
  const byType = new Map<string, { n: number; decisionRight: number; missedAction: number }>()
  for (const r of read) {
    const key = typeOf(r.document.documentTypeId)
    const row = byType.get(key) ?? { n: 0, decisionRight: 0, missedAction: 0 }
    row.n += 1
    const s = r.suggestion as Suggestion
    if (s?.disposition === r.truthDisposition) row.decisionRight += 1
    if (r.truthDisposition === 'ACTION' && s?.disposition === 'ARCHIVE') row.missedAction += 1
    byType.set(key, row)
  }
  console.log(`${'type'.padEnd(14)}${'n'.padStart(5)}${'decision'.padStart(11)}${'missed action'.padStart(15)}`)
  for (const [key, row] of [...byType].sort((a, b) => b[1].n - a[1].n)) {
    console.log(
      `${key.padEnd(14)}${String(row.n).padStart(5)}${`${row.decisionRight}/${row.n}`.padStart(11)}${String(row.missedAction).padStart(15)}`,
    )
  }
  console.log('\nA type needs both: enough documents to mean anything, and zero missed actions,')
  console.log('before its auto-archive switch should be turned on.')

  // -------------------------------------------------------------------------
  // 5. Divergences, for a person to judge.
  // -------------------------------------------------------------------------
  const diverged = read.filter((r) => {
    const s = r.suggestion as Suggestion
    return (
      s?.disposition !== r.truthDisposition ||
      (r.extraction as Extraction)?.entityCode !== codeOf(r.truthEntityId)
    )
  })

  bar(`5. Divergences to read (${diverged.length}) — the spreadsheet is wrong sometimes too`)
  for (const r of diverged) {
    const s = r.suggestion as Suggestion
    const x = r.extraction as Extraction
    const parts: string[] = []
    if (s?.disposition !== r.truthDisposition) {
      parts.push(`decision ${r.truthDisposition} → ${s?.disposition ?? '—'}`)
    }
    if (x?.entityCode !== codeOf(r.truthEntityId)) {
      parts.push(`entity ${codeOf(r.truthEntityId)} → ${x?.entityCode ?? '—'}`)
    }
    console.log(`  ${r.document.originalFilename}`)
    console.log(`      ${parts.join('   |   ')}`)
    if (x?.addresseeName) console.log(`      addressee as printed: ${x.addresseeName}`)
  }

  if (unread.length > 0) {
    bar(`Unreadable (${unread.length})`)
    for (const r of unread) console.log(`  ${r.document.originalFilename} — ${r.readError}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
