import 'dotenv/config'
import { requireSafeTarget } from './db-target'
import { prisma } from '../src/server/db/client'

/**
 * Phase A of docs/PLAN-types.md: a document's *type* stops carrying what it is *about*.
 *
 * ---------------------------------------------------------------------------
 * Why a script and not a migration
 * ---------------------------------------------------------------------------
 *
 * A migration runs itself on the next deploy. This changes 164 real documents and must
 * not happen until Eric and Chris have approved the two lists — so it is a thing
 * somebody runs, at a moment they chose, against a database they named. The same reason
 * the historical import was a screen rather than a migration.
 *
 * It also writes no schema. Types and categories are rows; this only adds some, points
 * documents at different ones, and deactivates the ones nobody should pick again.
 *
 * ---------------------------------------------------------------------------
 * Usage
 * ---------------------------------------------------------------------------
 *
 *   tsx scripts/remap-types.ts --dry     what it would do, touching nothing
 *   tsx scripts/remap-types.ts           do it
 *   tsx scripts/remap-types.ts --undo    put every document back
 *
 * Running it twice is harmless: the second run finds nothing on the old types.
 */

/** The five, as agreed. Three already exist; their labels are brought into line. */
const TYPES = [
  { code: 'INVOICE', label: 'Invoice', defaultAction: 'ASK', sortOrder: 10 },
  { code: 'CHECK', label: 'Check received', defaultAction: 'ARCHIVE', sortOrder: 20 },
  { code: 'NOTICE', label: 'Letter or notice', defaultAction: 'ACTION', sortOrder: 30 },
  { code: 'STATEMENT', label: 'Statement', defaultAction: 'ARCHIVE', sortOrder: 40 },
  { code: 'OTHER', label: 'Other', defaultAction: 'ASK', sortOrder: 50 },
] as const

/** Tax and Payroll are new; without them the largest group in the log lands in "Other". */
const CATEGORIES = ['Tax', 'Payroll'] as const

/**
 * Old code → what it becomes.
 *
 * `category: null` means the document keeps whatever category it has, which today is
 * none. `type: null` means the type is deliberately left alone — the insurance case,
 * where the category is certain and the type genuinely is not.
 */
const MAP: { from: string; type: string | null; category: string | null; why: string }[] = [
  { from: 'BILL', type: 'INVOICE', category: null, why: 'a bill is an invoice' },
  { from: 'IRS_NOTICE', type: 'NOTICE', category: 'Tax', why: 'a notice, about tax' },
  { from: 'TAX_NOTICE', type: 'NOTICE', category: 'Tax', why: 'a notice, about tax' },
  { from: 'TAX_PR_NOTICE', type: 'NOTICE', category: 'Tax', why: 'a notice, about tax' },
  { from: 'PAYROLL', type: 'NOTICE', category: 'Payroll', why: 'a form or notice, about payroll' },
  {
    from: 'SPAM',
    type: 'OTHER',
    category: null,
    why: 'spam is a reason, already recorded as one; the type was never a kind',
  },
  {
    from: 'INSURANCE',
    type: null,
    category: 'Insurance',
    why: 'insurance is the category; which kind of document it is cannot be read off this',
  },
]

/** Types nobody should be able to pick again. Never deleted — documents point at them. */
const RETIRE = ['BILL', 'IRS_NOTICE', 'TAX_NOTICE', 'TAX_PR_NOTICE', 'PAYROLL', 'SPAM']

const dry = process.argv.includes('--dry')
const undo = process.argv.includes('--undo')

async function main() {
  requireSafeTarget(undo ? 'undo the type remap' : dry ? 'preview the type remap' : 'remap document types')

  const group = await prisma.companyGroup.findFirstOrThrow({
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  })
  console.log(`workspace: ${group.name}\n`)

  if (undo) return reverse(group.id)

  // ---------------------------------------------------------------- what is there now
  const before = await counts(group.id)
  console.log('BEFORE')
  for (const row of before) console.log(`  ${row.code.padEnd(16)} ${String(row.n).padStart(4)}`)

  const types = await prisma.documentType.findMany({
    where: { companyGroupId: group.id },
    select: { id: true, code: true },
  })
  const byCode = new Map(types.map((t) => [t.code, t.id]))

  let willChange = 0
  let willCategorise = 0
  console.log('\nPLAN')
  for (const rule of MAP) {
    const fromId = byCode.get(rule.from)
    if (!fromId) {
      console.log(`  ${rule.from.padEnd(16)} — not in this database, skipping`)
      continue
    }
    const n = await prisma.document.count({
      where: { companyGroupId: group.id, deletedAt: null, documentTypeId: fromId },
    })
    if (rule.type) willChange += n
    if (rule.category) willCategorise += n
    console.log(
      `  ${rule.from.padEnd(16)} ${String(n).padStart(4)} → ${(rule.type ?? '(type unchanged)').padEnd(18)} ${rule.category ?? ''}`,
    )
  }
  console.log(`\n  ${willChange} documents change type, ${willCategorise} gain a category`)

  if (dry) {
    console.log('\n--dry: nothing was written.')
    return
  }

  // ---------------------------------------------------------------------- make it so
  for (const t of TYPES) {
    await prisma.documentType.upsert({
      where: { companyGroupId_code: { companyGroupId: group.id, code: t.code } },
      create: { companyGroupId: group.id, ...t },
      // Only the label and order are brought into line; an existing type keeps its id,
      // so every document already pointing at CHECK, STATEMENT or OTHER is untouched.
      update: { label: t.label, sortOrder: t.sortOrder, isActive: true },
    })
  }

  for (const name of CATEGORIES) {
    await prisma.category.upsert({
      where: { companyGroupId_name: { companyGroupId: group.id, name } },
      create: { companyGroupId: group.id, name },
      update: { isActive: true },
    })
  }

  const fresh = await prisma.documentType.findMany({
    where: { companyGroupId: group.id },
    select: { id: true, code: true },
  })
  const typeId = new Map(fresh.map((t) => [t.code, t.id]))
  const cats = await prisma.category.findMany({
    where: { companyGroupId: group.id },
    select: { id: true, name: true },
  })
  const catId = new Map(cats.map((c) => [c.name, c.id]))

  let moved = 0
  for (const rule of MAP) {
    const fromId = typeId.get(rule.from)
    if (!fromId) continue

    const docs = await prisma.document.findMany({
      where: { companyGroupId: group.id, deletedAt: null, documentTypeId: fromId },
      select: { id: true, categoryId: true },
    })

    for (const doc of docs) {
      const toType = rule.type ? typeId.get(rule.type) ?? null : null
      const toCat = rule.category ? catId.get(rule.category) ?? null : null

      await prisma.$transaction(async (tx) => {
        await tx.document.update({
          where: { id: doc.id },
          data: {
            ...(toType ? { documentTypeId: toType } : {}),
            // A category already chosen by a person is never overwritten.
            ...(toCat && doc.categoryId === null ? { categoryId: toCat } : {}),
          },
        })

        /*
         * The undo, written one document at a time.
         *
         * Not a backup and not a log file: an event on the document itself, in the same
         * append-only history as every other change, which the database will not let
         * anybody edit. The reversal reads these back.
         */
        await tx.documentEvent.create({
          data: {
            documentId: doc.id,
            actorUserId: null,
            action: 'reclassified',
            fromValue: { documentTypeCode: rule.from, categoryId: doc.categoryId },
            toValue: {
              documentTypeCode: rule.type ?? rule.from,
              category: rule.category,
              via: 'type-remap',
              why: rule.why,
            },
          },
        })
      })
      moved += 1
    }
  }

  // Out of the dropdowns, still valid for every document that points at one.
  const retired = await prisma.documentType.updateMany({
    where: { companyGroupId: group.id, code: { in: RETIRE } },
    data: { isActive: false },
  })

  console.log(`\nDONE`)
  console.log(`  ${moved} documents rewritten`)
  console.log(`  ${retired.count} old types deactivated (none deleted)`)

  const after = await counts(group.id)
  console.log('\nAFTER')
  for (const row of after) console.log(`  ${row.code.padEnd(16)} ${String(row.n).padStart(4)}`)
  console.log('\nUndo with:  tsx scripts/remap-types.ts --undo')
}

async function counts(companyGroupId: string) {
  const rows = await prisma.$queryRaw<{ code: string | null; n: bigint }[]>`
    SELECT t.code, count(*) AS n
    FROM document d LEFT JOIN document_type t ON t.id = d.document_type_id
    WHERE d.company_group_id = ${companyGroupId} AND d.deleted_at IS NULL AND d.is_demo = false
    GROUP BY t.code ORDER BY n DESC`
  return rows.map((r) => ({ code: r.code ?? '(no type)', n: Number(r.n) }))
}

/** Puts every document back on the type it had, from the events the run wrote. */
async function reverse(companyGroupId: string) {
  const events = await prisma.documentEvent.findMany({
    where: { action: 'reclassified', document: { companyGroupId } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, documentId: true, fromValue: true, toValue: true },
  })

  const mine = events.filter((e) => {
    const v = e.toValue as { via?: string } | null
    return v?.via === 'type-remap'
  })

  if (mine.length === 0) {
    console.log('No remap to undo — no document carries one of its events.')
    return
  }

  const types = await prisma.documentType.findMany({
    where: { companyGroupId },
    select: { id: true, code: true },
  })
  const typeId = new Map(types.map((t) => [t.code, t.id]))

  // Newest first, and only the most recent per document, so a document remapped twice
  // goes back to where it started rather than to the middle.
  const seen = new Set<string>()
  let back = 0

  for (const e of mine) {
    if (seen.has(e.documentId)) continue
    seen.add(e.documentId)

    const from = e.fromValue as { documentTypeCode?: string; categoryId?: string | null } | null
    const code = from?.documentTypeCode
    if (!code || !typeId.has(code)) continue

    await prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: e.documentId },
        data: {
          documentTypeId: typeId.get(code)!,
          categoryId: from?.categoryId ?? null,
        },
      })
      await tx.documentEvent.create({
        data: {
          documentId: e.documentId,
          actorUserId: null,
          action: 'reclassified',
          toValue: { documentTypeCode: code, via: 'type-remap-undo' },
        },
      })
    })
    back += 1
  }

  // The old types work again, because they were only ever deactivated.
  await prisma.documentType.updateMany({
    where: { companyGroupId, code: { in: RETIRE } },
    data: { isActive: true },
  })

  console.log(`${back} documents put back, and the old types are selectable again.`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
