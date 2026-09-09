import { prisma } from '@/server/db/client'
import { canSeeWholeLog, canWork, requireSession } from '@/server/session'
import { getObject } from '@/server/storage'

/**
 * Streams a payment's receipt for the in-app viewer.
 *
 * Addressed by payment id rather than by storage key, so the tenant check happens
 * before any bytes are read — exactly as for document scans. A member who may only see
 * their own work can only pull the receipts they recorded.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireSession()
  // The scanner uploads and never reads back: no document, no receipt, no export.
  if (!canWork(session.role)) return new Response('Not found', { status: 404 })
  const { id } = await ctx.params

  const payment = await prisma.payment.findFirst({
    where: {
      id,
      companyGroupId: session.companyGroupId,
      ...(canSeeWholeLog(session.role) ? {} : { recordedByUserId: session.userId }),
    },
    select: {
      receiptStorageKey: true,
      receiptStorageBucket: true,
      receiptMimeType: true,
      receiptFilename: true,
    },
  })

  if (!payment?.receiptStorageKey) return new Response('Not found', { status: 404 })

  const bytes = await getObject(payment.receiptStorageKey, payment.receiptStorageBucket)

  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': payment.receiptMimeType ?? 'application/octet-stream',
      // inline, so a receipt opens in the row rather than landing in Downloads
      'Content-Disposition': `inline; filename="${encodeURIComponent(
        payment.receiptFilename ?? 'receipt',
      )}"`,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, max-age=300',
    },
  })
}
