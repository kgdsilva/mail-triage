import 'dotenv/config'
import { requireSafeTarget } from '../scripts/db-target'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '../src/server/db/client'

/**
 * Invoices for three of the demo bills, so the side panel has something in it.
 *
 * Written by hand rather than with a PDF library: this needs one page of text, and a
 * dependency for that is a dependency to keep forever. The format below is the minimum
 * a viewer accepts — catalogue, page tree, one content stream, two of the fonts every
 * reader already has — with the cross-reference offsets computed rather than guessed,
 * which is the only fiddly part.
 *
 * ---------------------------------------------------------------------------
 * These are fake, and they say so on their face
 * ---------------------------------------------------------------------------
 *
 * Every field is read back out of the demo row it belongs to, so the page agrees with
 * the list — same absurd vendor, same invoice number, same amount, same due date. No
 * real document is copied, read or moved. The page carries "SAMPLE — DEMO DATA" twice,
 * because a plausible-looking invoice with nothing marking it as fake is the kind of
 * thing that ends up in a folder nobody questions.
 *
 * They live under `.storage/demo/`, which is the prefix `demo:purge` cleans and the only
 * one it will touch.
 */

/** Which bills get one. Pending, in the approver's scope, one of them overdue. */
const WANTED = ['UC-10231', 'HU-558120', 'PL-0442']

const LOCAL_ROOT = path.join(process.cwd(), '.storage')
const PREFIX = 'demo'

type Line = { text: string; size: number; bold?: boolean; gap?: number; grey?: boolean }

/** PDF strings are parenthesised, so the parentheses and backslashes have to go. */
function esc(text: string) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function contentStream(lines: Line[]) {
  const parts: string[] = [
    // A navy band across the top, so it reads as a document and not a text file.
    '0.07 0.16 0.29 rg 0 742 612 50 re f',
    'BT /F1 18 Tf 1 1 1 rg 42 758 Td (INVOICE) Tj ET',
  ]

  let y = 700
  for (const line of lines) {
    const font = line.bold ? '/F1' : '/F2'
    const colour = line.grey ? '0.45 0.45 0.45 rg' : '0.1 0.1 0.1 rg'
    parts.push(`BT ${font} ${line.size} Tf ${colour} 42 ${y} Td (${esc(line.text)}) Tj ET`)
    y -= line.gap ?? line.size + 8
  }

  // The watermark, twice, at an angle no reader will miss.
  parts.push('BT /F1 46 Tf 0.9 0.9 0.9 rg 1 0 0 1 70 420 Tm (SAMPLE) Tj ET')
  parts.push('BT /F1 20 Tf 0.75 0.75 0.75 rg 1 0 0 1 70 370 Tm (DEMO DATA — NOT A REAL INVOICE) Tj ET')

  return parts.join('\n')
}

function buildPdf(lines: Line[]) {
  const stream = contentStream(lines)

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []

  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })

  const xrefAt = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`

  return Buffer.from(pdf, 'latin1')
}

function money(amount: unknown) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    Number(String(amount ?? 0)),
  )
}

function day(date: Date | null) {
  return date
    ? new Intl.DateTimeFormat('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(date)
    : '—'
}

async function main() {
  requireSafeTarget('attach demo invoice PDFs')

  const bills = await prisma.document.findMany({
    where: { isDemo: true, invoiceNumber: { in: WANTED } },
    include: {
      vendor: { select: { name: true } },
      entity: { select: { code: true, legalName: true } },
      category: { select: { name: true } },
    },
  })

  if (bills.length === 0) throw new Error('No demo bills found — run demo:seed first.')

  await mkdir(path.join(LOCAL_ROOT, PREFIX), { recursive: true })

  const done: string[] = []

  for (const bill of bills) {
    const lines: Line[] = [
      { text: bill.vendor?.name ?? 'Unknown vendor', size: 16, bold: true, gap: 18 },
      { text: '1 Example Way, Springfield, PA 19064', size: 9, grey: true, gap: 11 },
      { text: 'billing@example.invalid', size: 9, grey: true, gap: 34 },

      { text: `Invoice number    ${bill.invoiceNumber}`, size: 11, gap: 17 },
      { text: `Invoice date      ${day(bill.documentDate)}`, size: 11, gap: 17 },
      { text: `Due date          ${day(bill.dueDate)}`, size: 11, bold: true, gap: 34 },

      { text: 'Bill to', size: 9, grey: true, gap: 14 },
      {
        text: `${bill.entity?.legalName ?? ''} (${bill.entity?.code ?? ''})`,
        size: 11,
        bold: true,
        gap: 36,
      },

      { text: `Description       ${bill.category?.name ?? 'Services'} — monthly`, size: 11, gap: 17 },
      { text: `Amount due        ${money(bill.amount)}`, size: 14, bold: true, gap: 40 },

      { text: 'Payable on receipt. Reference the invoice number with payment.', size: 9, grey: true, gap: 13 },
      { text: 'Questions: accounts@example.invalid', size: 9, grey: true },
    ]

    const bytes = buildPdf(lines)
    const key = `${PREFIX}/${bill.invoiceNumber}.pdf`
    await writeFile(path.join(LOCAL_ROOT, key), bytes)

    await prisma.document.update({
      where: { id: bill.id },
      data: {
        storageKey: key,
        // `local` is what the storage layer calls the on-disk bucket. These files exist
        // on this machine only — a deployment reads R2 and will show nothing attached.
        storageBucket: 'local',
        mimeType: 'application/pdf',
        byteSize: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    })

    // Said in the history, like any other attachment, so the audit panel is not silent
    // about where the file came from.
    const already = await prisma.documentEvent.count({
      where: { documentId: bill.id, action: 'file-attached' },
    })
    if (already === 0) {
      await prisma.documentEvent.create({
        data: {
          documentId: bill.id,
          actorUserId: null,
          action: 'file-attached',
          toValue: { originalFilename: `${bill.invoiceNumber}.pdf`, demo: true, key },
        },
      })
    }

    done.push(
      `  ${bill.entity?.code ?? '??'}  ${bill.vendor?.name}  ${bill.invoiceNumber}  ${money(
        bill.amount,
      )}  ${bytes.byteLength} bytes`,
    )
  }

  console.log(`Attached ${done.length} demo invoice${done.length === 1 ? '' : 's'}:`)
  console.log(done.join('\n'))
  console.log(`\nFiles are in .storage/${PREFIX}/ and nowhere else.`)
  console.log('They exist on this machine only — a deployed app reads R2 and will see none.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
