import { prisma } from '@/server/db/client'

/**
 * Maps a document type to the folder people already use for it. Falls back to the
 * entity's Correspondence folder rather than guessing wrong.
 *
 * These are the folder names the historical log actually used, taken from where 352
 * documents were really filed rather than from a tidier tree. It matters more than it
 * looks: file a new bill into "Finances > Bills" while five months of them sit in
 * "Finances > Bills & Expenses" and the history is split in two, with neither half
 * complete.
 *
 * Tax notices go to Tax IRS because that is where twenty-two of twenty-five went — the
 * team treats it as the tax folder, not strictly the federal one.
 *
 * Spam is the one deliberate departure: seven of the eight went into "Finances > Other",
 * which is a folder for things nobody classified, and a solicitation is classified. New
 * ones go to Correspondence > Spam; the imported rows keep the folder they were put in.
 */
const FOLDER_BY_TYPE: Record<string, string> = {
  IRS_NOTICE: 'Finances > Tax IRS',
  TAX_NOTICE: 'Finances > Tax IRS',
  TAX_PR_NOTICE: 'Finances > Tax PR',
  BILL: 'Finances > Bills & Expenses',
  STATEMENT: 'Finances > Statements',
  CHECK: 'Finances > Copies of Checks',
  INSURANCE: 'Finances > Insurance',
  PAYROLL: 'Human Resources > Payroll',
  OTHER: 'Finances > Other',
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
