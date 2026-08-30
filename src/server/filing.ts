import { prisma } from '@/server/db/client'

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

export async function suggestFolder(
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
