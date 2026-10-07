import { prisma } from '@/server/db/client'
import { entityWhere, visibleEntityIds } from '@/server/scope'
import { canSearchArchive, canSeeWholeLog, canWork, requireSession } from '@/server/session'
import { getObject } from '@/server/storage'

/**
 * Streams a stored document, for the in-app viewer or as a download.
 *
 * Files are addressed by document id, not by storage key, so the tenant check happens
 * before any bytes are read — an object key alone is never enough to fetch a file.
 *
 * Who may read which bytes mirrors who may see which record, and has to: a scoped role
 * that could pull any file by id would have no scope at all. Three cases, narrowing —
 * the roles that browse the whole log, the ones restricted to their own companies, and
 * a member who sees only what is routed to them.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireSession()
  // The scanner uploads and never reads back.
  if (!canWork(session.role) && !canSearchArchive(session.role)) {
    return new Response('Not found', { status: 404 })
  }

  const { id } = await ctx.params
  const scope = await visibleEntityIds(session)

  const doc = await prisma.document.findFirst({
    where: {
      id,
      companyGroupId: session.companyGroupId,
      deletedAt: null,
      ...entityWhere(scope),
      // A member who may not open the record in the log must not be able to pull its
      // bytes by id either. Scoped roles are already bounded by their entities above.
      ...(canSeeWholeLog(session.role) || scope !== null
        ? {}
        : { assignedToUserId: session.userId }),
    },
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
  // Same bytes either way; only the header differs. "Download" on a list and the inline
  // viewer are the same permission and the same file, so they are the same route.
  const download = new URL(req.url).searchParams.get('download') === '1'

  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': doc.mimeType ?? 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(
        filename.endsWith('.pdf') ? filename : `${filename}.pdf`,
      )}"`,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, max-age=300',
    },
  })
}
