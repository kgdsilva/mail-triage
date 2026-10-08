import 'dotenv/config'
import { requireSafeTarget } from './db-target'
import { prisma } from '../src/server/db/client'
import { readDocument } from '../src/server/ai/read-document'
import { buildSuggestion } from '../src/server/ai/suggest'
import type { Prisma } from '../src/generated/prisma/client'

/**
 * Scores the reader against documents whose answer a person already gave.
 *
 * ---------------------------------------------------------------------------
 * What it will not do
 * ---------------------------------------------------------------------------
 *
 * It never writes to `document`. Not the entity, not the decision, not the status, not
 * even `ai_suggestion` — the imported history *is* the answer key, and the normal
 * reading path would overwrite it, adopt an entity from the page and possibly auto-apply
 * a decision. That is why this calls `readDocument` and `buildSuggestion` rather than
 * `analyzeDocument`: same code, same prompt, same rules, no writes.
 *
 * Results go to `ai_eval_result`, with the answer key copied in beside them so a later
 * correction cannot quietly rewrite a past score.
 *
 * ---------------------------------------------------------------------------
 * Usage
 * ---------------------------------------------------------------------------
 *
 *   tsx scripts/ai-eval.ts --limit=10 --label="pilot"
 *   tsx scripts/ai-eval.ts --label="baseline before entity matcher"
 *
 *   --limit=N     stop after N documents (the pilot; ten is enough for a cost figure)
 *   --label=TEXT  how this run will be named in the report. Required.
 *   --note=TEXT   what changed since last time, in your words
 *   --dry         pick the set, print the cost estimate, call nothing
 *
 * Every document costs one model call. There is no way to measure without spending, so
 * the estimate is printed before the full run and the pilot exists to make it real.
 */

type Args = { limit: number | null; label: string; note: string | null; dry: boolean }

function parseArgs(): Args {
  const get = (name: string) => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
    return hit ? hit.slice(name.length + 3) : null
  }
  return {
    limit: get('limit') ? Number.parseInt(get('limit')!, 10) : null,
    label: get('label') ?? '',
    note: get('note'),
    dry: process.argv.includes('--dry'),
  }
}

/** Sonnet, per million tokens. Only used for the estimate printed to the screen. */
const PRICE = { input: 2 / 1_000_000, output: 10 / 1_000_000 }
/** Measured on a one-page scan. Multi-page documents cost proportionally more. */
const TYPICAL = { input: 1_850, output: 260 }

function money(n: number) {
  return `$${n.toFixed(2)}`
}

async function main() {
  const args = parseArgs()
  if (!args.label) {
    console.error('A --label is required: it is how you will tell two runs apart.')
    process.exit(1)
  }

  // Reads only, but it still connects, and which database it connects to decides whether
  // the answer key is the real one.
  requireSafeTarget('run a read-only AI evaluation')

  const group = await prisma.companyGroup.findFirstOrThrow({
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  })

  /*
   * The eval set: a human decision, an entity, and a file to read. All three are
   * required — a document with no stored PDF cannot be read at all, and one with no
   * decision has no answer to be scored against.
   */
  const candidates = await prisma.document.findMany({
    where: {
      companyGroupId: group.id,
      deletedAt: null,
      isDemo: false,
      storageKey: { not: null },
      entityId: { not: null },
      disposition: { not: 'UNREVIEWED' },
    },
    orderBy: { createdAt: 'asc' },
    ...(args.limit ? { take: args.limit } : {}),
    select: {
      id: true,
      originalFilename: true,
      entityId: true,
      documentTypeId: true,
      disposition: true,
      actionKind: true,
      byteSize: true,
    },
  })

  console.log(`workspace : ${group.name}`)
  console.log(`documents : ${candidates.length}${args.limit ? ` (limited to ${args.limit})` : ''}`)
  const estimate =
    candidates.length * (TYPICAL.input * PRICE.input + TYPICAL.output * PRICE.output)
  console.log(`estimate  : ${money(estimate)} at one page each, more if multi-page`)

  if (args.dry) {
    console.log('\n--dry: nothing was called and nothing was written.')
    return
  }
  if (candidates.length === 0) {
    console.log('Nothing to score.')
    return
  }

  const run = await prisma.aiEvalRun.create({
    data: {
      companyGroupId: group.id,
      label: args.label,
      model: process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5',
      note: args.note,
      documentCount: candidates.length,
    },
    select: { id: true },
  })
  console.log(`run id    : ${run.id}\n`)

  let input = 0
  let output = 0
  let failed = 0

  for (const [i, doc] of candidates.entries()) {
    const label = `[${String(i + 1).padStart(3)}/${candidates.length}] ${doc.originalFilename}`

    const read = await readDocument(group.id, doc.id)

    // The answer key is copied in on every row, not looked up at report time: a
    // correction made next week must not change what this run scored.
    const truth = {
      truthEntityId: doc.entityId,
      truthDocumentTypeId: doc.documentTypeId,
      truthDisposition: doc.disposition,
      truthActionKind: doc.actionKind,
    }

    if (!read.ok) {
      failed += 1
      console.log(`${label}  — could not read: ${read.error}`)
      await prisma.aiEvalResult.create({
        data: { runId: run.id, documentId: doc.id, ...truth, readError: read.error },
      })
      continue
    }

    const suggestion = await buildSuggestion(group.id, read.extraction)

    input += read.usage.input
    output += read.usage.output

    await prisma.aiEvalResult.create({
      data: {
        runId: run.id,
        documentId: doc.id,
        ...truth,
        extraction: read.extraction as unknown as Prisma.InputJsonValue,
        suggestion: suggestion as unknown as Prisma.InputJsonValue,
        inputTokens: read.usage.input,
        outputTokens: read.usage.output,
      },
    })

    const agrees = suggestion.disposition === doc.disposition
    console.log(`${label}  — ${suggestion.disposition}${agrees ? '' : `  ≠ ${doc.disposition}`}`)
  }

  await prisma.aiEvalRun.update({
    where: { id: run.id },
    data: { finishedAt: new Date(), inputTokens: input, outputTokens: output },
  })

  const spent = input * PRICE.input + output * PRICE.output
  console.log(`\nread ${candidates.length - failed} of ${candidates.length}, ${failed} failed`)
  console.log(`tokens: ${input} in / ${output} out  —  about ${money(spent)}`)
  console.log(`\nReport:  tsx scripts/ai-eval-report.ts --run=${run.id}`)
  console.log('No document was modified by this run.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
