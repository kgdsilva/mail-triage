import { prisma } from '@/server/db/client'
import { requireSession } from '@/server/session'
import { getObject } from '@/server/storage'

/**
 * Streams a stored document for the in-app viewer.
 *
 * Files are addressed by document id, not by storage key, so the tenant check happens
 * before any bytes are read — an object key alone is never enough to fetch a file.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireSession()
  const { id } = await ctx.params

  const doc = await prisma.document.findFirst({
    where: { id, companyGroupId: session.companyGroupId, deletedAt: null },
    select: {
      storageKey: true,
      storageBucket: true,
      mimeType: true,
      finalFilename: true,
      originalFilename: true,
    },
  })

  if (!doc?.storageKey) {
    return new Response('Not found', { status: 404 })
  }

  const bytes = await getObject(doc.storageKey, doc.storageBucket)
  const filename = doc.finalFilename ?? doc.originalFilename

  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': doc.mimeType ?? 'application/pdf',
      // inline so the browser's own PDF viewer renders it in the classify pane
      'Content-Disposition': `inline; filename="${encodeURIComponent(filename)}"`,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, max-age=300',
    },
  })
}
