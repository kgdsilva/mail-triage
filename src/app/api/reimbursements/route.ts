import path from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { prisma } from '@/server/db/client'
import { recordEvent } from '@/server/documents'
import { buildKey, putObject } from '@/server/storage'

export const dynamic = 'force-dynamic'

/**
 * Where an expense report arrives from the HQ site.
 *
 * ---------------------------------------------------------------------------
 * One report, one bill, one cheque
 * ---------------------------------------------------------------------------
 *
 * "If I travel and pay for food, a hotel and an Uber, it is all one reimbursement cheque
 * but it is from three receipts." So a report is a bill: its total is the amount, every
 * receipt in it is filed against that one bill, and each expense becomes a line in the
 * note so the approver can see what the total is made of before clearing it.
 *
 * Three expenses do not become three bills. That was the whole point of asking.
 *
 * ---------------------------------------------------------------------------
 * What it is not
 * ---------------------------------------------------------------------------
 *
 * Not a second kind of bill. What arrives here lands in exactly the state a bill added
 * by hand lands in — company, payee, amount, receipts, waiting on the approver — and is
 * approved and paid down the same path by the same people. The difference ends at how
 * it got in, which is the same promise `addBill` makes about email.
 */

/** The platform's ceiling on a request body, not ours. */
const MAX_BYTES = 4 * 1024 * 1024
const ALLOWED = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/tiff'])

type Fail = { status: number; error: string }

const fail = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status })

/**
 * A shared secret, compared in constant time.
 *
 * Off is the safe default for a door: with no secret configured this refuses every call
 * rather than accepting them, because an unverified endpoint that works is worse than
 * one that does not — nobody notices the first kind. The same rule the forwarding
 * address follows.
 */
function authorise(headers: Headers): Fail | null {
  const expected = process.env.REIMBURSEMENT_SECRET?.trim()
  if (!expected) {
    return { status: 503, error: 'REIMBURSEMENT_SECRET is not set, so this refuses to run.' }
  }

  const offered = (headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!offered) return { status: 401, error: 'Missing Authorization: Bearer <secret>.' }

  const a = Buffer.from(offered)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { status: 401, error: 'That secret is not the one configured here.' }
  }
  return null
}

/** The expense lines, however they were sent. */
function readExpenses(form: FormData) {
  const lines: { from: string; amount: string; description: string }[] = []

  const one = (i: number | null) => {
    const key = (name: string) => (i === null ? name : `${name}_${i}`)
    const from = String(form.get(key('from')) ?? '').trim()
    const amount = String(form.get(key('amount')) ?? '').trim()
    const description = String(form.get(key('description')) ?? '').trim()
    if (!from && !amount && !description) return false
    lines.push({ from, amount, description })
    return true
  }

  // Indexed first — from_1, amount_1, description_1 — then the single-expense shape.
  for (let i = 1; i <= 50; i++) if (!one(i)) break
  if (lines.length === 0) one(null)

  return lines
}

export async function POST(request: Request) {
  const refusal = authorise(request.headers)
  if (refusal) return fail(refusal.status, refusal.error)

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return fail(400, 'Send multipart/form-data, with the receipts as file parts.')
  }

  const reportId = String(form.get('report_id') ?? '').trim()
  const idempotencyKey = (request.headers.get('idempotency-key') ?? '').trim() || reportId
  if (!idempotencyKey) {
    return fail(400, 'Send an Idempotency-Key header, or a report_id to stand in for one.')
  }

  /*
   * A retry must not write a second cheque's worth of bill.
   *
   * The key is recorded on the document's own event trail rather than in a table of its
   * own: that trail is append-only, already exists, and is the place this system answers
   * "what happened to this document" from. Finding the key means the report is already
   * here, and the honest reply is the bill that was made the first time.
   */
  const seen = await prisma.documentEvent.findFirst({
    where: {
      action: 'added_by_hand',
      toValue: { path: ['reimbursementKey'], equals: idempotencyKey },
    },
    select: { documentId: true },
  })
  if (seen) {
    return NextResponse.json({ ok: true, documentId: seen.documentId, duplicate: true })
  }

  const companyCode = String(form.get('company_code') ?? '').trim().toUpperCase()
  if (!companyCode) return fail(400, 'company_code is required.')

  const entities = await prisma.entity.findMany({
    where: { code: companyCode, isActive: true },
    select: { id: true, code: true, companyGroupId: true },
  })
  if (entities.length === 0) return fail(400, `No company here has the code ${companyCode}.`)
  if (entities.length > 1) {
    return fail(409, `${companyCode} matches more than one company, so this cannot tell which.`)
  }
  const entity = entities[0]

  const currency = (String(form.get('currency') ?? 'USD').trim() || 'USD').toUpperCase()
  if (currency !== 'USD') return fail(400, `Only USD is recorded here, and this said ${currency}.`)

  const total = Number(String(form.get('report_total') ?? '').replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(total) || total <= 0) {
    return fail(400, 'report_total must be a number greater than zero.')
  }

  const submittedByName = String(form.get('submitted_by_name') ?? '').trim()
  if (!submittedByName) return fail(400, 'submitted_by_name is required — it is who the cheque goes to.')
  const submittedByEmail = String(form.get('submitted_by_email') ?? '').trim()

  const dueRaw = String(form.get('due_date') ?? '').trim()
  const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(dueRaw) ? new Date(`${dueRaw}T00:00:00Z`) : null

  const receipts = Array.from({ length: 50 }, (_, i) => form.get(`receipt_${i + 1}`)).filter(
    (f): f is File => f instanceof File && f.size > 0,
  )
  if (receipts.length === 0) {
    return fail(400, 'Attach at least one receipt — a reimbursement with no evidence cannot be approved.')
  }

  for (const f of receipts) {
    if (!ALLOWED.has(f.type || 'application/pdf')) {
      return fail(400, `${f.type} is not a document the reader can open.`)
    }
  }
  const bytes = receipts.reduce((sum, f) => sum + f.size, 0)
  if (bytes > MAX_BYTES) {
    return fail(413, `Those receipts come to ${(bytes / 1024 / 1024).toFixed(1)} MB, and the limit is 4 MB.`)
  }

  /*
   * The person has to be one of ours, and this refuses rather than guessing.
   *
   * Three reasons, and the first is the ordinary one: a cheque is about to be written to
   * somebody, and the office should know who they are. The second is that every entry in
   * the trail then has an actor instead of "system", on the one kind of bill where who
   * asked for the money is the question. The third is structural — a receipt is linked to
   * its bill by a row that records who linked it, and with nobody to name that row cannot
   * be written, so the receipts would silently fail to attach and the approver would be
   * shown a total with no evidence under it.
   */
  if (!submittedByEmail) {
    return fail(400, 'submitted_by_email is required — it is how this knows who is being paid.')
  }

  const member = await prisma.membership.findFirst({
    where: {
      companyGroupId: entity.companyGroupId,
      isActive: true,
      user: { email: { equals: submittedByEmail, mode: 'insensitive' } },
    },
    select: { userId: true },
  })
  if (!member) {
    return fail(
      403,
      `${submittedByEmail} is not an active member of this workspace, so no cheque can be raised for them. Add them in Settings → Members first.`,
    )
  }

  const expenses = readExpenses(form)
  const description = String(form.get('description') ?? '').trim()

  /*
   * What the total is made of, in the note the approver reads. A figure with no
   * breakdown is a figure somebody has to go and ask about.
   */
  const noteLines = [
    `Reimbursement to ${submittedByName}${submittedByEmail ? ` (${submittedByEmail})` : ''}.`,
    ...expenses.map((e) =>
      [e.from, e.amount ? `$${e.amount}` : null, e.description].filter(Boolean).join(' — '),
    ),
    expenses.length === 0 && description ? description : null,
    reportId ? `Report ${reportId}.` : null,
  ].filter(Boolean)

  const reimbursement = await prisma.category.findFirst({
    where: { companyGroupId: entity.companyGroupId, isActive: true, name: { equals: 'Reimbursement', mode: 'insensitive' } },
    select: { id: true },
  })
  const billType = await prisma.documentType.findFirst({
    where: { companyGroupId: entity.companyGroupId, code: 'BILL' },
    select: { id: true },
  })

  const [first, ...rest] = receipts
  const firstType = first.type || 'application/pdf'
  const stored = await putObject(
    buildKey(entity.companyGroupId, path.extname(first.name) || '.pdf'),
    Buffer.from(await first.arrayBuffer()),
    firstType,
  )

  const doc = await prisma.document.create({
    data: {
      companyGroupId: entity.companyGroupId,
      originalFilename: first.name,
      storageKey: stored.key,
      storageBucket: stored.bucket,
      mimeType: firstType,
      byteSize: stored.byteSize,
      sha256: stored.sha256,
      entityId: entity.id,
      documentTypeId: billType?.id ?? null,
      categoryId: reimbursement?.id ?? null,
      payeeName: submittedByName,
      amount: total.toFixed(2),
      dueDate,
      disposition: 'ACTION',
      dispositionReason: 'MANUAL_INVOICE',
      actionKind: 'PAY',
      status: 'WAITING',
      approvalStatus: 'PENDING',
      summaryNote: noteLines.join('\n'),
      reviewedByUserId: member.userId,
      reviewedAt: new Date(),
    },
    select: { id: true },
  })

  await recordEvent({
    documentId: doc.id,
    actorUserId: member.userId,
    action: 'added_by_hand',
    toValue: {
      via: 'reimbursement-webhook',
      reimbursementKey: idempotencyKey,
      reportId: reportId || null,
      entity: entity.code,
      submittedBy: submittedByName,
      submittedByEmail: submittedByEmail || null,
      amount: total.toFixed(2),
      receipts: receipts.length,
      addedBy: submittedByName,
    },
  })

  // The other receipts, filed beside the bill and pointed at it — the same shape Add a
  // bill uses, so one reimbursement reads identically whichever door it came through.
  for (const extra of rest) {
    try {
      const extraType = extra.type || 'application/pdf'
      const extraStored = await putObject(
        buildKey(entity.companyGroupId, path.extname(extra.name) || '.pdf'),
        Buffer.from(await extra.arrayBuffer()),
        extraType,
      )
      const receipt = await prisma.document.create({
        data: {
          companyGroupId: entity.companyGroupId,
          originalFilename: extra.name,
          storageKey: extraStored.key,
          storageBucket: extraStored.bucket,
          mimeType: extraType,
          byteSize: extraStored.byteSize,
          sha256: extraStored.sha256,
          entityId: entity.id,
          disposition: 'ARCHIVE',
          dispositionReason: 'OTHER',
          status: 'DONE',
          summaryNote: `Receipt filed with ${first.name}.`,
          reviewedByUserId: member.userId,
          reviewedAt: new Date(),
        },
        select: { id: true },
      })
      await prisma.documentLink.create({
        data: {
          fromDocumentId: receipt.id,
          toDocumentId: doc.id,
          relation: 'RELATED_TO',
          createdByUserId: member.userId,
          note: 'Receipt for this reimbursement',
        },
      })
    } catch {
      // The bill stands. A receipt that did not attach shows as one fewer in the list.
    }
  }

  return NextResponse.json({ ok: true, documentId: doc.id, receipts: receipts.length })
}
