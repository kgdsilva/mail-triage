/**
 * What counts as a money document, written once because two things depend on it.
 *
 * The accountant's inbox asks "is this mine?" and the router asks "does this go to the
 * accountant?", and those have to be the same question — a routing rule that disagrees
 * with the screen it routes to produces documents nobody can find.
 *
 * ---------------------------------------------------------------------------
 * The rule, as agreed
 * ---------------------------------------------------------------------------
 *
 * In, because somebody has to decide whether money leaves:
 *
 *   - bills;
 *   - government and tax notices — UC, FAMLI, EDD, TWC, liens — which carry a balance,
 *     a penalty or a missing filing, and whose deadlines are short;
 *   - payroll documents and wage garnishment orders;
 *   - third-party collections;
 *   - anything already marked as needing payment;
 *   - anything carrying an amount that is not one of the kinds ruled out below.
 *
 * Out, deliberately:
 *
 *   - a cheque received. Money arriving carries no decision about paying, and letting
 *     it in here is how an incoming cheque became a thing to pay once already.
 *   - an informational letter with no amount and no deadline. If there is nothing to
 *     pay and nothing to answer, it is filing, not a decision.
 *   - a solicitation. It is ruled out by type, not by judgement — the reader has to
 *     quote a disclaimer before anything is called spam, and that happens earlier.
 *
 * Unknown entity is not in here either, and that is a routing rule rather than a
 * definition: a document whose company nobody could determine stays with the person who
 * can work that out, however much money it mentions.
 */

import { Prisma } from '@/generated/prisma/client'

/**
 * Types that are about money by their nature, whatever else is on the page.
 *
 * Codes, not labels: the labels are editable in Settings and two of them are being
 * reworked (Eric's type-versus-category split), so matching on a label would break the
 * moment somebody renames one.
 */
export const MONEY_TYPE_CODES = [
  'BILL',
  'TAX_NOTICE',
  'IRS_NOTICE',
  'TAX_PR_NOTICE',
  'PAYROLL',
] as const

/** Types that are never the accountant's decision, whatever amount they carry. */
export const NOT_MONEY_TYPE_CODES = ['CHECK', 'SPAM'] as const

/**
 * The money half of a query, as a Prisma fragment.
 *
 * Expressed in columns rather than in the reader's extraction on purpose. `moneyDirection`
 * and the ambiguity flag live inside the `aiSuggestion` JSON, and a screen that had to
 * reach into JSON to decide what to show would be both slow and impossible to index.
 * Those two signals are used where they belong — at routing time, when the suggestion is
 * fresh and the decision is being made once.
 */
export function moneyWhere(): Prisma.DocumentWhereInput {
  return {
    OR: [
      // Already on its way to being paid, however it got there.
      { actionKind: 'PAY' },
      { approvalStatus: { not: null } },
      // Money by kind.
      { documentType: { code: { in: [...MONEY_TYPE_CODES] } } },
      /*
       * Or it names a sum. This is what catches the collection agency letter and the
       * state notice that arrived under a type nobody has created yet — the amount is
       * the tell. Ruled-out kinds are excluded here rather than in a second clause,
       * because an incoming cheque always carries an amount.
       */
      {
        amount: { not: null },
        documentType: { is: { code: { notIn: [...NOT_MONEY_TYPE_CODES] } } },
      },
    ],
  }
}

/**
 * Whether a document the reader has just described is the accountant's to decide.
 *
 * This is the routing-time twin of `moneyWhere`, and it sees what the query cannot: the
 * direction the money is going, and whether the reader was unsure. A bill the model is
 * confident about and a document it could not make up its mind on both belong to the
 * accountant — the second one especially, because "I am not sure whether this has to be
 * paid" is exactly the question being handed over.
 */
export function isMoneyDecision(input: {
  typeCode: string | null
  actionKind: string | null
  amount: number | null
  /** From the reader: owed_by_us, received_by_us, or neither. */
  moneyDirection: string | null
  /** The reader could not settle on a disposition. */
  ambiguous: boolean
  /** Null when nobody could tell which company it belongs to. */
  entityId: string | null
}): boolean {
  // Whose company it is comes first: an unplaced document is not anybody's decision yet.
  if (!input.entityId) return false

  if (input.typeCode && (NOT_MONEY_TYPE_CODES as readonly string[]).includes(input.typeCode)) {
    return false
  }
  if (input.moneyDirection === 'received_by_us') return false

  if (input.actionKind === 'PAY') return true
  if (input.typeCode && (MONEY_TYPE_CODES as readonly string[]).includes(input.typeCode)) return true
  if (input.moneyDirection === 'owed_by_us' && input.amount !== null) return true

  // Unsure, and placed: the doubt itself is the thing being handed over.
  if (input.ambiguous) return true

  return false
}
