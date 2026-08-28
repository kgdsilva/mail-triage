import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ClassifyForm } from '@/components/classify-form'
import { prisma } from '@/server/db/client'
import { countUnreviewed, getDocument, nextUnreviewed } from '@/server/documents'
import { requireTriage } from '@/server/session'

export const dynamic = 'force-dynamic'

export default async function ClassifyPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireTriage()
  const { id } = await params

  const doc = await getDocument(session.companyGroupId, id)
  if (!doc) notFound()

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
          <p className="text-xs text-neutral-500">
            {doc.batch?.label ?? 'No batch'} · uploaded{' '}
            {doc.createdAt.toLocaleDateString('en-US')}
          </p>
        </div>
        <p className="shrink-0 text-xs text-neutral-500">
          {remaining} awaiting a decision
        </p>
      </div>

      {duplicates.length > 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
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
        <div className="h-[calc(100vh-190px)] min-h-[520px] overflow-hidden rounded border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-800">
          {doc.storageKey ? (
            <iframe
              src={`/api/files/${doc.id}#view=FitH`}
              title={doc.originalFilename}
              className="h-full w-full"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-neutral-500">
              No file attached to this record.
            </div>
          )}
        </div>

        <ClassifyForm
          document={{
            id: doc.id,
            originalFilename: doc.originalFilename,
            finalFilename: doc.finalFilename,
            entityId: doc.entityId,
            documentTypeId: doc.documentTypeId,
            vendorId: doc.vendorId,
            vendorName: doc.vendor?.name ?? '',
            documentDate: doc.documentDate?.toISOString().slice(0, 10) ?? '',
            dueDate: doc.dueDate?.toISOString().slice(0, 10) ?? '',
            amount: doc.amount?.toString() ?? '',
            disposition: doc.disposition,
            dispositionReason: doc.dispositionReason,
            status: doc.status,
            storageFolderId: doc.storageFolderId,
            summaryNote: doc.summaryNote ?? '',
            internalNotes: doc.internalNotes ?? '',
            assignedToUserId: doc.assignedToUserId,
            actionKind: doc.actionKind,
          }}
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
