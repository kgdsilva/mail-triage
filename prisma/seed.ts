import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
})

/**
 * Template document types. Each company group gets its own copy at onboarding and
 * owns it from then on — a new group can start from this and diverge freely.
 *
 * `defaultAction` only pre-fills the classify screen; it never commits a decision.
 * Two rules from the brief are encoded here and should not be loosened:
 *   - Deadline-bearing government notices are ACTION, never ARCHIVE, however small
 *     the dollar amount.
 *   - BILL is ASK, not ARCHIVE, because whether it archives depends entirely on the
 *     autopay lookup for that vendor+entity — which the classify screen resolves.
 */
const DOCUMENT_TYPES = [
  { code: 'BILL', label: 'Bill', defaultAction: 'ASK', sortOrder: 10 },
  { code: 'TAX_NOTICE', label: 'Tax Notice', defaultAction: 'ACTION', sortOrder: 20 },
  { code: 'IRS_NOTICE', label: 'IRS Notice', defaultAction: 'ACTION', sortOrder: 30 },
  { code: 'TAX_PR_NOTICE', label: 'Tax / PR Notice', defaultAction: 'ACTION', sortOrder: 40 },
  { code: 'CHECK', label: 'Check (incoming)', defaultAction: 'ARCHIVE', sortOrder: 50 },
  { code: 'INSURANCE', label: 'Insurance', defaultAction: 'ASK', sortOrder: 60 },
  { code: 'STATEMENT', label: 'Statement', defaultAction: 'ARCHIVE', sortOrder: 70 },
  { code: 'SPAM', label: 'Spam / Solicitation', defaultAction: 'ARCHIVE', sortOrder: 80 },
  { code: 'OTHER', label: 'Other', defaultAction: 'ASK', sortOrder: 90 },
] as const

/**
 * Pilot company group. `isSegregated` puts an entity in its own tab rather than mixed
 * into the group-wide list — a display choice, never a permission.
 */
const COLAB_ENTITIES = [
  { code: 'CP', legalName: 'CoLAB Processing', sortOrder: 10, isSegregated: false },
  { code: 'CCS', legalName: 'CoLAB Concierge Service', sortOrder: 20, isSegregated: false },
  { code: 'MM', legalName: 'Marsh & Munar', sortOrder: 30, isSegregated: false },
  { code: 'MMT', legalName: 'Marsh & Munar Team LLC', sortOrder: 40, isSegregated: false },
  { code: 'OP', legalName: 'CoLAB Ops Perfection LLC', sortOrder: 50, isSegregated: true },
] as const

/**
 * Aliases are how a scan gets matched back to an entity when the filename does not say.
 * OP appears in official documents fully capitalised with a slash.
 */
const ENTITY_ALIASES: Record<string, string[]> = {
  OP: ['CO/LAB OPS PERFECTION, LLC', 'CoLAB Ops Perfection'],
  MMT: ['Marsh & Munar Team'],
}

/** Default folder tree created under each entity, mirroring the current Box layout. */
const FOLDER_TREE: Record<string, string[]> = {
  Finances: ['Tax IRS', 'Tax State', 'Bills', 'Bank Statements', 'Checks Received'],
  Insurance: [],
  Legal: [],
  Correspondence: ['Spam'],
}

async function main() {
  const group = await prisma.companyGroup.upsert({
    where: { slug: 'colab' },
    create: {
      name: 'CoLAB Lending Franchise',
      slug: 'colab',
      timezone: 'America/New_York',
      settings: {
        filenameTemplate: '{entity}_{date}_{type}_{amount}',
        dateFormat: 'MM-DD-YY',
        currency: 'USD',
      },
    },
    update: {},
  })
  console.log(`✔ company group ${group.name}`)

  for (const type of DOCUMENT_TYPES) {
    await prisma.documentType.upsert({
      where: { companyGroupId_code: { companyGroupId: group.id, code: type.code } },
      create: { ...type, companyGroupId: group.id },
      // Only re-sync ordering. Label and defaultAction are left alone so a seed
      // re-run never silently reverts a change made in the admin UI.
      update: { sortOrder: type.sortOrder },
    })
  }
  console.log(`✔ ${DOCUMENT_TYPES.length} document types`)

  for (const e of COLAB_ENTITIES) {
    const entity = await prisma.entity.upsert({
      where: { companyGroupId_code: { companyGroupId: group.id, code: e.code } },
      create: { ...e, companyGroupId: group.id },
      update: { legalName: e.legalName, sortOrder: e.sortOrder, isSegregated: e.isSegregated },
    })

    for (const alias of ENTITY_ALIASES[e.code] ?? []) {
      await prisma.entityAlias.upsert({
        where: { entityId_aliasText: { entityId: entity.id, aliasText: alias } },
        create: { entityId: entity.id, aliasText: alias, source: 'NAME' },
        update: {},
      })
    }

    for (const [parentName, children] of Object.entries(FOLDER_TREE)) {
      const parentPath = `${e.code} > ${parentName}`
      const parent = await prisma.storageFolder.upsert({
        where: { companyGroupId_pathCache: { companyGroupId: group.id, pathCache: parentPath } },
        create: {
          companyGroupId: group.id,
          entityId: entity.id,
          name: parentName,
          pathCache: parentPath,
        },
        update: {},
      })

      for (const child of children) {
        const childPath = `${parentPath} > ${child}`
        await prisma.storageFolder.upsert({
          where: { companyGroupId_pathCache: { companyGroupId: group.id, pathCache: childPath } },
          create: {
            companyGroupId: group.id,
            entityId: entity.id,
            parentId: parent.id,
            name: child,
            pathCache: childPath,
          },
          update: {},
        })
      }
    }
  }
  console.log(`✔ ${COLAB_ENTITIES.length} entities with folder trees`)

  // The first owner. Authentication is allowlist-based, so this membership is what
  // makes it possible to sign in at all — see src/auth.ts. Emails are stored lowercased
  // because that is what Google returns.
  const operator = await prisma.user.upsert({
    where: { email: 'kg@colabservice.com' },
    create: { email: 'kg@colabservice.com', name: 'Kauê Guireli' },
    update: {},
  })
  await prisma.membership.upsert({
    where: { userId_companyGroupId: { userId: operator.id, companyGroupId: group.id } },
    create: { userId: operator.id, companyGroupId: group.id, role: 'OWNER' },
    update: { role: 'OWNER', isActive: true },
  })
  console.log(`✔ operator ${operator.email}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
