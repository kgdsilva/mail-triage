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
  { code: 'PAYROLL', label: 'Payroll (W2/1099)', defaultAction: 'ASK', sortOrder: 65 },
  { code: 'STATEMENT', label: 'Statement', defaultAction: 'ARCHIVE', sortOrder: 70 },
  { code: 'SPAM', label: 'Spam / Solicitation', defaultAction: 'ARCHIVE', sortOrder: 80 },
  { code: 'OTHER', label: 'Other', defaultAction: 'ASK', sortOrder: 90 },
] as const

/**
 * The workspaces this database is bootstrapped with.
 *
 * A workspace is a `CompanyGroup`: the tenant boundary. Megan's businesses and Megan's
 * personal affairs share a person and nothing else — separate entities, separate
 * document types, separate folder trees, separate logs — so they are two groups rather
 * than two labels inside one. That is also what stops a personal water bill ever
 * appearing in a business log, by construction rather than by filtering.
 *
 * `isSegregated` puts an entity in its own tab rather than mixed into the group-wide
 * list — a display choice, never a permission.
 *
 * How a scan gets matched back to an entity: a document never prints the code, it
 * prints a legal name, a trading name, or a DBA that shares no words with either. Both
 * the filename parser and the AI reader match against `aliases`, so an entity with none
 * is matched on its legal name alone, which is the case that quietly fails. MM is the
 * one worth noting — it trades as Keystone Alliance Mortgage, which resembles neither
 * its code nor its legal name.
 */
type SeedEntity = {
  code: string
  legalName: string
  sortOrder: number
  isSegregated: boolean
  /** Names printed on a document. Matched inside longer text, so only ever a hint. */
  aliases?: string[]
  /**
   * The word typed at the front of a scan's filename. Matched whole and it wins
   * outright — "Munar" appears inside "Marsh & Munar Team" too, so as a fragment it
   * identifies nothing, while as a prefix somebody types it identifies one company.
   */
  filenamePrefixes?: string[]
}

type SeedGroup = {
  name: string
  slug: string
  entities: SeedEntity[]
}

/**
 * Default folder tree created under each entity, mirroring the current Box layout.
 *
 * These are the names the folders really have, read back off five months of filed
 * documents rather than invented here — see FOLDER_BY_TYPE in src/server/filing.ts,
 * which has to agree with them or new mail lands beside the history instead of in it.
 */
const FOLDER_TREE: Record<string, string[]> = {
  Finances: [
    'Bills & Expenses',
    'Copies of Checks',
    'Statements',
    'Tax IRS',
    'Tax PR',
    'Insurance',
    'Notices',
    'Accounting Reports',
    'Other',
  ],
  'Human Resources': ['Payroll', 'Benefits'],
  Legal: [],
  Correspondence: ['Spam'],
}

const GROUPS: SeedGroup[] = [
  {
    name: "Megan's Companies",
    slug: 'colab',
    entities: [
      {
        code: 'CP',
        legalName: 'CoLAB Processing',
        sortOrder: 10,
        isSegregated: false,
        aliases: ['CoLAB Processing', 'Co/LAB Processing LLC'],
        // The prefix whoever scans the post types at the front of the filename.
        filenamePrefixes: ['Processing', 'Processsing'],
      },
      {
        code: 'CCS',
        legalName: 'CoLAB Concierge Service',
        sortOrder: 20,
        isSegregated: false,
        aliases: ['CoLAB Concierge Service', 'CoLAB Concierge Services'],
        filenamePrefixes: ['Concierge', 'Concerierge'],
      },
      {
        code: 'MM',
        legalName: 'Munar Mortgage LLC',
        sortOrder: 30,
        isSegregated: false,
        aliases: [
          'Munar Mortgage',
          'Munar Mortgage LLC',
          'Keystone Alliance Mortgage',
          'Co/LAB Lending',
          'Co/LAB Lending LLC',
          'CoLAB Lending',
        ],
        filenamePrefixes: ['Munar', 'ColabLending'],
      },
      {
        code: 'MMT',
        legalName: 'Marsh & Munar Team LLC',
        sortOrder: 40,
        isSegregated: false,
        aliases: ['Marsh & Munar Team', 'Marsh & Munar Team LLC', 'CoLAB Franchise'],
        filenamePrefixes: ['Marsh', 'ColabFranchise'],
      },
      {
        code: 'OP',
        legalName: 'CoLAB Ops Perfection LLC',
        sortOrder: 50,
        isSegregated: true,
        aliases: ['CO/LAB OPS PERFECTION, LLC', 'CoLAB Ops Perfection'],
        filenamePrefixes: ['OP', 'OPr', 'OpsPrfProcessing', 'OptsPerfection'],
      },
    ],
  },
  {
    // Provisional, and named as such: the codes and the fourth entity's name are still
    // being settled, and this side of the work has not started.
    name: "Megan's Personal Items",
    slug: 'megan-personal',
    entities: [
      {
        code: 'MGP',
        legalName: 'Megan Marsh (Personal)',
        sortOrder: 10,
        isSegregated: false,
        aliases: ['Megan Marsh'],
      },
      {
        code: 'LBP',
        legalName: 'Laban Marsh (Personal)',
        sortOrder: 20,
        isSegregated: false,
        aliases: ['Laban Marsh'],
      },
      {
        code: 'HSH',
        legalName: 'Household / Shared',
        sortOrder: 30,
        isSegregated: false,
      },
      {
        code: 'LBC',
        legalName: "Laban's Company (name to be confirmed)",
        sortOrder: 40,
        isSegregated: false,
      },
    ],
  },
]

async function main() {
  // The first way in. Authentication is allowlist-based, so a freshly created database
  // locks everyone out: no member exists, so nobody can sign in, so nobody can add a
  // member. This owner is what breaks that circle — see src/auth.ts.
  //
  // Driven by BOOTSTRAP_OWNER_EMAIL rather than a hardcoded address, because the next
  // group onboarded will have a different owner. Emails are stored lowercased because
  // that is what Google returns.
  const ownerEmail = (process.env.BOOTSTRAP_OWNER_EMAIL || 'kg@colabservice.com')
    .trim()
    .toLowerCase()

  const owner = await prisma.user.upsert({
    where: { email: ownerEmail },
    create: { email: ownerEmail },
    update: {},
  })

  for (const definition of GROUPS) {
    const group = await prisma.companyGroup.upsert({
      where: { slug: definition.slug },
      create: {
        name: definition.name,
        slug: definition.slug,
        timezone: 'America/New_York',
        settings: {
          filenameTemplate: '{entity}_{date}_{type}_{amount}',
          dateFormat: 'MM-DD-YY',
          currency: 'USD',
        },
      },
      update: { name: definition.name },
    })

    for (const type of DOCUMENT_TYPES) {
      await prisma.documentType.upsert({
        where: { companyGroupId_code: { companyGroupId: group.id, code: type.code } },
        create: { ...type, companyGroupId: group.id },
        // Only re-sync ordering. Label and defaultAction are left alone so a seed
        // re-run never silently reverts a change made in the admin UI.
        update: { sortOrder: type.sortOrder },
      })
    }

    for (const e of definition.entities) {
      const entity = await prisma.entity.upsert({
        where: { companyGroupId_code: { companyGroupId: group.id, code: e.code } },
        create: {
          companyGroupId: group.id,
          code: e.code,
          legalName: e.legalName,
          sortOrder: e.sortOrder,
          isSegregated: e.isSegregated,
        },
        update: { legalName: e.legalName, sortOrder: e.sortOrder, isSegregated: e.isSegregated },
      })

      for (const alias of e.aliases ?? []) {
        await prisma.entityAlias.upsert({
          where: { entityId_aliasText: { entityId: entity.id, aliasText: alias } },
          create: { entityId: entity.id, aliasText: alias, source: 'NAME' },
          update: {},
        })
      }

      for (const prefix of e.filenamePrefixes ?? []) {
        await prisma.entityAlias.upsert({
          where: { entityId_aliasText: { entityId: entity.id, aliasText: prefix } },
          create: { entityId: entity.id, aliasText: prefix, source: 'FILENAME' },
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

    // The owner belongs to every workspace this seed creates, which is what makes the
    // switcher in the header have anything to switch between.
    await prisma.membership.upsert({
      where: { userId_companyGroupId: { userId: owner.id, companyGroupId: group.id } },
      create: { userId: owner.id, companyGroupId: group.id, role: 'OWNER' },
      update: { role: 'OWNER', isActive: true },
    })

    console.log(
      `✔ ${group.name} — ${DOCUMENT_TYPES.length} document types, ` +
        `${definition.entities.length} entities with folder trees`,
    )
  }

  console.log(`✔ owner ${owner.email} — sign in with Google or set a password for them`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
