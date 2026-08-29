import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ClassifyForm } from '@/components/classify-form'
import { prisma } from '@/server/db/client'
import { countUnreviewed, getDocument, nextUnreviewed } from '@/server/documents'
import { requireTriage } from '@/server/session'
import { aiConfigured } from '@/server/ai/read-document'
import type { AiSuggestion } from '@/server/ai/suggest'

export const dynamic = 'force-dynamic'

export default async function ClassifyPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireTriage()
  const { id } = await params

  const doc = await getDocument(session.companyGroupId, id)
  if (!doc) notFound()

  /**
   * What the model read off this document, if it has been read.
   *
   * Pre-fills every field the record does not already carry a human answer for. The
   * upload path kicks a read off in the background, so by the time someone opens a
   * document this is usually waiting; when it is not, the form offers to read on
   * demand rather than leaving the operator with a blank screen.
   */
  const ai = (doc.aiSuggestion as AiSuggestion | null) ?? null
  const aiAvailable = aiConfigured()

  const [entities, types, folders, users, next, remaining, duplicates] = await Promise.all([
    prisma.entity.findMany({
      where: { companyGroupId: session.companyGroupId, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, code: true, legalName: true },
    }),
    prisma.documentType.findMany({
      where: { companyGroupId: session.companyGroupId, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, code: true, label: true },
    }),
    prisma.storageFolder.findMany({
      where: { companyGroupId: session.companyGroupId },
      orderBy: { pathCache: 'asc' },
      select: { id: true, pathCache: true },
    }),
    prisma.membership.findMany({
      where: { companyGroupId: session.companyGroupId, isActive: true },
      select: { user: { select: { id: true, name: true, email: true } }, role: true },
    }),
    nextUnreviewed(session.companyGroupId, id),
    countUnreviewed(session.companyGroupId),
    prisma.documentLink.findMany({
      where: { fromDocumentId: id, relation: 'DUPLICATE_OF' },
      select: { toDocument: { select: { id: true, originalFilename: true, documentDate: true } } },
    }),
  ])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold" title={doc.originalFilename}>
            {doc.originalFilename}
          </h1>
          <p className="text-xs text-muted">
            {doc.batch?.label ?? 'No batch'} · uploaded{' '}
            {doc.createdAt.toLocaleDateString('en-US')}
          </p>
        </div>
        <p className="shrink-0 text-xs text-muted">
          {remaining} awaiting a decision
        </p>
      </div>

      {duplicates.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-gold-50 px-3 py-2 text-xs text-amber-900">
          Identical file content already in the log:{' '}
          {duplicates.map((d, i) => (
            <span key={d.toDocument.id}>
              {i > 0 && ', '}
              <Link href={`/classify/${d.toDocument.id}`} className="underline">
                {d.toDocument.originalFilename}
              </Link>
            </span>
          ))}
          . Confirm this is a genuinely new document before treating it as one.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_460px]">
        {/* The viewer lives in the app rather than bouncing out to Box. */}
        <div className="h-[calc(100vh-190px)] min-h-[520px] overflow-hidden rounded-lg border border-line bg-line-soft">
          {doc.storageKey ? (
            <iframe
              src={`/api/files/${doc.id}#view=FitH`}
              title={doc.originalFilename}
              className="h-full w-full"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted">
              No file attached to this record.
            </div>
          )}
        </div>

        <ClassifyForm
          document={{
            id: doc.id,
            originalFilename: doc.originalFilename,
            finalFilename: doc.finalFilename,
            entityId: doc.entityId ?? ai?.entityId ?? null,
            documentTypeId: doc.documentTypeId ?? ai?.documentTypeId ?? null,
            vendorId: doc.vendorId ?? ai?.vendorId ?? null,
            vendorName: doc.vendor?.name ?? ai?.vendorName ?? '',
            documentDate:
              doc.documentDate?.toISOString().slice(0, 10) ?? ai?.documentDate ?? '',
            dueDate: doc.dueDate?.toISOString().slice(0, 10) ?? ai?.dueDate ?? '',
            amount: doc.amount?.toString() ?? (ai?.amount != null ? String(ai.amount) : ''),
            // A decision is never pre-filled once a human has made one.
            disposition:
              doc.disposition === 'UNREVIEWED' && ai ? ai.disposition : doc.disposition,
            dispositionReason: doc.dispositionReason ?? ai?.dispositionReason ?? null,
            status: doc.status,
            storageFolderId: doc.storageFolderId,
            summaryNote: doc.summaryNote ?? ai?.summary ?? '',
            internalNotes: doc.internalNotes ?? '',
            assignedToUserId: doc.assignedToUserId,
            actionKind: doc.actionKind,
          }}
          ai={
            ai
              ? {
                  rationale: ai.rationale,
                  confidence: ai.confidence,
                  ambiguous: ai.ambiguous,
                  readAt: ai.readAt,
                }
              : null
          }
          aiAvailable={aiAvailable}
          entities={entities}
          types={types}
          folders={folders}
          people={users.map((m) => ({
            id: m.user.id,
            label: m.user.name ?? m.user.email,
          }))}
          nextId={next?.id ?? null}
        />
      </div>
    </div>
  )
}
