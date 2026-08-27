'use server'

import { suggestDisposition, type FilterVerdict } from '@/server/action-filter'
import { prisma } from '@/server/db/client'
import { suggestFilename } from '@/server/filename'
import { requireSession } from '@/server/session'

/**
 * Live feedback for the classify screen: as the operator picks entity, type and vendor,
 * this re-runs the action filter and the naming convention so the suggestion and the
 * reasoning behind it are visible before anything is saved.
 */
export type Suggestion = {
  verdict: FilterVerdict
  filename: string
  /** Folder the convention points at, so filing is one click rather than a tree walk. */
  folderId: string | null
  folderPath: string | null
}

export async function getSuggestion(input: {
  entityId: string | null
  documentTypeId: string | null
  vendorId: string | null
  documentDate: string | null
  amount: string | null
  extension: string
}): Promise<Suggestion> {
  const session = await requireSession()

  const docDate = input.documentDate ? new Date(`${input.documentDate}T00:00:00Z`) : null
  const validDate = docDate && !Number.isNaN(docDate.getTime()) ? docDate : null

  const verdict = await suggestDisposition({
    companyGroupId: session.companyGroupId,
    entityId: input.entityId,
    documentTypeId: input.documentTypeId,
    vendorId: input.vendorId,
    onDate: validDate ?? undefined,
  })

  const [group, entity, type] = await Promise.all([
    prisma.companyGroup.findUnique({
      where: { id: session.companyGroupId },
      select: { settings: true },
    }),
    input.entityId
      ? prisma.entity.findUnique({ where: { id: input.entityId }, select: { code: true } })
      : null,
    input.documentTypeId
      ? prisma.documentType.findUnique({
          where: { id: input.documentTypeId },
          select: { label: true, code: true },
        })
      : null,
  ])

  const rawAmount = input.amount ? Number(input.amount.replace(/[$,]/g, '')) : null

  const filename = suggestFilename(
    {
      entityCode: entity?.code ?? null,
      documentDate: validDate,
      typeLabel: type?.label ?? null,
      amount: rawAmount != null && Number.isFinite(rawAmount) ? rawAmount : null,
      extension: input.extension,
    },
    (group?.settings as { filenameTemplate?: string; dateFormat?: string }) ?? {},
  )

  const folder = await suggestFolder(session.companyGroupId, input.entityId, type?.code ?? null)

  return { verdict, filename, folderId: folder?.id ?? null, folderPath: folder?.pathCache ?? null }
}

/**
 * Maps a document type to the folder people already use for it. Falls back to the
 * entity's Correspondence folder rather than guessing wrong.
 */
const FOLDER_BY_TYPE: Record<string, string> = {
  IRS_NOTICE: 'Finances > Tax IRS',
  TAX_NOTICE: 'Finances > Tax State',
  TAX_PR_NOTICE: 'Finances > Tax State',
  BILL: 'Finances > Bills',
  STATEMENT: 'Finances > Bank Statements',
  CHECK: 'Finances > Checks Received',
  INSURANCE: 'Insurance',
  SPAM: 'Correspondence > Spam',
}

async function suggestFolder(
  companyGroupId: string,
  entityId: string | null,
  typeCode: string | null,
) {
  if (!entityId) return null
  const entity = await prisma.entity.findUnique({
    where: { id: entityId },
    select: { code: true },
  })
  if (!entity) return null

  const suffix = (typeCode && FOLDER_BY_TYPE[typeCode]) || 'Correspondence'
  return prisma.storageFolder.findFirst({
    where: { companyGroupId, pathCache: `${entity.code} > ${suffix}` },
    select: { id: true, pathCache: true },
  })
}

/** Creates a vendor inline from the classify screen, or returns the existing match. */
export async function findOrCreateVendor(name: string) {
  const session = await requireSession()
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Vendor name is required.')

  const existing = await prisma.vendor.findFirst({
    where: { companyGroupId: session.companyGroupId, name: { equals: trimmed, mode: 'insensitive' } },
  })
  if (existing) return { id: existing.id, name: existing.name, knownSpam: existing.knownSpam }

  const created = await prisma.vendor.create({
    data: { companyGroupId: session.companyGroupId, name: trimmed },
  })
  return { id: created.id, name: created.name, knownSpam: created.knownSpam }
}

/** Fuzzy vendor lookup for the combobox, using the trigram index. */
export async function searchVendors(query: string) {
  const session = await requireSession()
  const q = query.trim()

  return prisma.vendor.findMany({
    where: {
      companyGroupId: session.companyGroupId,
      ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
    },
    orderBy: { name: 'asc' },
    take: 8,
    select: { id: true, name: true, knownSpam: true },
  })
}
