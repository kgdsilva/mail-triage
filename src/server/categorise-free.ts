/**
 * Placing documents from what is already stored, without paying to read anything.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 *
 * The first backfill cost about twelve dollars and put nearly everything in "Other",
 * because the categories it could choose from described a software company. The obvious
 * repair is to read all of it again with the right list, and the obvious repair costs
 * another twelve dollars to answer questions that are already answered on screen.
 *
 * Because the sender is usually in the filename. `CP_06-12-26_PADOL_UCBalance_706` is
 * the Pennsylvania Department of Labor; `TexasWorkforce_StatementOfAccount` is the Texas
 * Workforce Commission; `CAEDD_OffsetCollections` is a collections notice. Those strings
 * are in the database already, were produced by a read that has been paid for, and cost
 * nothing to match.
 *
 * ---------------------------------------------------------------------------
 * What this is and is not
 * ---------------------------------------------------------------------------
 *
 * It is a lookup, not a judgement. It fires only on an unambiguous name — an agency, a
 * title company, a tax authority — and abstains on everything else. Abstaining is the
 * common case and the correct one: a document it cannot place is left for the reader,
 * which is where the money should go.
 *
 * Every row it writes records that it came from a rule and which rule, so a wrong one is
 * findable by the pattern that caused it rather than one document at a time. That is the
 * price of a heuristic: not that it is sometimes wrong, but that being wrong must be
 * traceable.
 */

import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/server/db/client'
import { needsRereadWhere, otherCategoryId } from '@/server/categorise'

/**
 * Patterns to category names, most specific first.
 *
 * Matched against the filename and the vendor name, both lowercased. Order matters where
 * two could fire: "department of revenue" must beat a bare "revenue", and the federal
 * tax authority must beat the state ones, because "internal revenue service" contains
 * "revenue" and is not a state agency.
 *
 * Each entry names the senders in this log it was written for. A pattern with no real
 * sender behind it is a guess, and a guess here files real money under a wrong heading.
 */
const RULES: { category: string; patterns: RegExp[]; because: string }[] = [
  /*
   * Tax forms first, before any sender.
   *
   * A 1099-NEC from a mortgage lender is a federal tax form that happens to arrive from
   * a bank, and matching the sender first filed it under Banking & loans — which is what
   * the first draft of this did to `EquityPrimeNonemployeeComp`. What a document *is*
   * outranks who sent it, so the forms are matched before the names.
   */
  {
    category: 'Taxes - federal',
    because: '1099 and W-2 forms, Internal Revenue Service',
    patterns: [
      // No trailing boundary: the filenames carry `1099Form` and `1099NEC`, and \b1099\b
      // matches neither — the digits run straight into the letters.
      /\b1099/,
      /\b1098/,
      /nonemployee\s*comp/,
      /\bw-?2\b/,
      /\birs\b/,
      /internal\s*revenue/,
    ],
  },
  /*
   * Named local tax collectors, before the form names below.
   *
   * Berkheimer and Jordan Tax collect earned-income tax for Pennsylvania boroughs, and
   * their mail is titled "Quarterly Return" — which the payroll rule below matched
   * first, filing a local tax bill under payroll. A sender this log knows by name
   * outranks a form name that several senders share.
   */
  {
    category: 'Taxes - state & local',
    because: 'Berkheimer Tax Innovations and Jordan Tax Service, local EIT collectors',
    patterns: [/berkheimer/, /jordan\s*tax/, /\beit\b/, /earned\s*income\s*tax/],
  },
  {
    category: 'Payroll & unemployment',
    because: 'Texas Workforce, Colorado FAMLI, PA Dept of Labor (UC), Departamento del Trabajo de PR',
    patterns: [
      /workforce/,
      /\bfamli\b/,
      /unemployment/,
      /\bpadol\b/,
      /dept?\.?\s*(of\s*)?labor/,
      /trabajo/,
      /seguridad\s*de\s*empleo/,
      /\buc\s*balance\b/,
      /\bui\s*tax\b/,
      /payroll/,
      /unreported\s*wages/,
      /\bwages?\s*report/,
      // A rate notice in this log is always an unemployment-insurance rate.
      /tax\s*rate\s*notice/,
      // Form 941 and its state equivalents, which is what an employer files quarterly.
      /quarterly\s*return/,
      /\b941\b/,
    ],
  },
  {
    category: 'Taxes - state & local',
    because: 'PA and FL Departments of Revenue, Berkheimer Tax Innovations',
    patterns: [
      // Space-tolerant, because the filenames arrive as PADeptRevenue and are split into
      // "pa dept revenue" before matching. Written without the \s* first, which made the
      // most common sender in the log match nothing at all.
      /dept?\.?\s*(of\s*)?revenue/,
      /revenue\s*depart/,
      /berkheimer/,
      /comptroller/,
      /franchise\s*tax/,
      /sales\s*tax/,
      /property\s*tax/,
      /\bassessor\b/,
      // Generic last: federal is already taken above, so a bare "tax notice" here is a
      // state or local one.
      /tax\s*notice/,
      /tax\s*assessment/,
      /\btax\s*bill\b/,
    ],
  },
  {
    category: 'Title & settlement',
    because: 'Laurel Settlement, Riverway Title, Capital Title of Texas, Old Republic Title, JMG Escrow',
    patterns: [/\btitle\b/, /settlement/, /escrow/, /closing\s*disclosure/],
  },
  {
    category: 'Collections',
    because: 'The CBE Group, CAEDD offset collections',
    patterns: [/collection/, /\bcbe\s*group\b/, /\bcaedd\b/, /debt\s*recovery/, /\bpast\s*due\b/],
  },
  {
    category: 'Tolls & vehicle',
    because: 'Tolls by Mail (MTA Bridges and Tunnels / Port Authority NY NJ / NYSTA)',
    patterns: [/\btoll/, /\bnysta\b/, /port\s*authority/, /\be-?zpass\b/, /\bdmv\b/, /\bmta\b/],
  },
  {
    category: 'Insurance',
    because: 'Farmers, Liberty Mutual / Safeco, Northwind Insurance',
    patterns: [/insurance/, /\bsafeco\b/, /liberty\s*mutual/, /\bfarmers\b/, /\bpolicy\b/],
  },
  {
    category: 'Banking & loans',
    because: 'Marquette Savings Bank, Capital One Business, Munar Mortgage',
    patterns: [
      /\bbank\b/,
      /savings\s*bank/,
      /\bmortgage\b/,
      /capital\s*one/,
      /\bloan\b/,
      /credit\s*union\b/,
      /\bamex\b/,
      /american\s*express/,
    ],
  },
  {
    category: 'Utilities',
    because: 'Harborlight Utilities',
    patterns: [/\butilit/, /\belectric\b/, /water\s*(bill|dept|department)/, /gas\s*(bill|company)/],
  },
  {
    category: 'Legal',
    because: 'Pinewood Legal LLP',
    patterns: [/\blegal\b/, /\bllp\b/, /attorney/, /law\s*(firm|office)/, /\bcounsel\b/],
  },
]

export type Placement = {
  documentId: string
  categoryName: string
  /** The exact pattern that fired, so a wrong rule is findable by its cause. */
  matched: string
  /** Which field carried it. */
  from: 'vendor' | 'filename'
}

/** The one place the matching happens, so the dry run and the real pass cannot differ. */
export function placementFor(doc: {
  id: string
  originalFilename: string
  finalFilename: string | null
  vendor: { name: string } | null
}): Placement | null {
  const vendor = doc.vendor?.name?.toLowerCase() ?? ''
  const filename = `${doc.finalFilename ?? ''} ${doc.originalFilename}`
    // Split before lowercasing, not after: `TexasWorkforce` and `PADeptRevenue` are one
    // word to a regex and two to a reader, and there is no camel case left to find once
    // everything is lower case. Written the wrong way round first, which matched nothing
    // and would have reported honest-looking zeros.
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[_\-.]+/g, ' ')

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      if (vendor && pattern.test(vendor)) {
        return { documentId: doc.id, categoryName: rule.category, matched: String(pattern), from: 'vendor' }
      }
    }
  }
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(filename)) {
        return { documentId: doc.id, categoryName: rule.category, matched: String(pattern), from: 'filename' }
      }
    }
  }
  return null
}

const SELECT = {
  id: true,
  originalFilename: true,
  finalFilename: true,
  vendor: { select: { name: true } },
} satisfies Prisma.DocumentSelect

/**
 * What the rules would place, without writing anything.
 *
 * Shown on screen before the button, next to what re-reading the rest would cost — the
 * two numbers that decide whether this is worth doing are "how many does this save" and
 * "how much is left", and both have to be visible before anybody spends anything.
 */
export async function placementDryRun(companyGroupId: string) {
  const other = await otherCategoryId(companyGroupId)
  const docs = await prisma.document.findMany({
    where: needsRereadWhere(companyGroupId, other),
    select: SELECT,
  })

  const placements = docs.map(placementFor).filter((p): p is Placement => p !== null)

  const byCategory = new Map<string, number>()
  for (const p of placements) byCategory.set(p.categoryName, (byCategory.get(p.categoryName) ?? 0) + 1)

  return {
    considered: docs.length,
    placed: placements.length,
    leftToRead: docs.length - placements.length,
    byCategory: [...byCategory.entries()].sort((a, b) => b[1] - a[1]),
  }
}

/**
 * Writes the placements the rules found.
 *
 * One pass over the whole queue rather than slices: there is no model call here, so a
 * few hundred documents is a few hundred updates and finishes inside one request.
 *
 * Each row records which pattern fired and that it came from a rule rather than a read.
 * That is not bookkeeping — it is the only way a bad pattern can be undone as a pattern.
 * Finding every document a rule mis-filed is a query; finding them by eye is a week.
 */
export async function applyPlacements(companyGroupId: string, actorUserId: string) {
  const other = await otherCategoryId(companyGroupId)
  const docs = await prisma.document.findMany({
    where: needsRereadWhere(companyGroupId, other),
    select: SELECT,
  })

  const categories = await prisma.category.findMany({
    where: { companyGroupId },
    select: { id: true, name: true },
  })
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]))

  let placed = 0
  let unknownCategory = 0

  for (const doc of docs) {
    const placement = placementFor(doc)
    if (!placement) continue

    const categoryId = byName.get(placement.categoryName.toLowerCase())
    if (!categoryId) {
      /*
       * The rule names a category this workspace does not have. It is skipped rather
       * than created: a rule inventing categories would quietly grow the list that this
       * whole exercise exists to get right, and the honest reading is that the migration
       * has not run here yet.
       */
      unknownCategory += 1
      continue
    }

    await prisma.$transaction(async (tx) => {
      const fresh = await tx.document.findFirst({
        where: {
          id: doc.id,
          OR: [{ categoryId: null }, ...(other ? [{ categoryId: other }] : [])],
        },
        select: { id: true },
      })
      if (!fresh) return

      await tx.document.update({ where: { id: doc.id }, data: { categoryId } })
      await tx.documentEvent.create({
        data: {
          documentId: doc.id,
          actorUserId,
          action: 'recategorised',
          toValue: {
            category: placement.categoryName,
            via: 'rules',
            matched: placement.matched,
            from: placement.from,
          },
        },
      })
      placed += 1
    })
  }

  return { considered: docs.length, placed, unknownCategory, leftToRead: docs.length - placed }
}
