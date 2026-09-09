/**
 * Reading the historical spreadsheet.
 *
 * Everything here is pure: text in, decisions out, no database and no side effects, so
 * the dry run and the real import cannot disagree about what a row means.
 *
 * The guiding rule is the same one the rest of the app follows — ambiguity resolves to
 * action, never to a silent archive. Where this file cannot map something it says so
 * and the row is held for a person, rather than being guessed into "Other" where nobody
 * would ever find it again.
 */

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * A minimal RFC 4180 reader: quoted fields, embedded commas, embedded newlines,
 * doubled quotes. Excel's own export is exactly this, and adding a dependency to read
 * one file a handful of times is not worth the supply chain.
 */
export function parseCsv(text: string): string[][] {
  // A UTF-8 BOM survives "Save as CSV UTF-8" and would become part of the first header.
  const src = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]

    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 1
        } else quoted = false
      } else field += ch
      continue
    }

    if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      // Treat CRLF as one break, and ignore blank lines between records.
      if (ch === '\r' && src[i + 1] === '\n') i += 1
      row.push(field)
      field = ''
      if (row.some((c) => c.trim() !== '')) rows.push(row)
      row = []
    } else field += ch
  }

  row.push(field)
  if (row.some((c) => c.trim() !== '')) rows.push(row)
  return rows
}

/** "Notified (Who)" and "notified_who" are the same column as far as this is concerned. */
function headerKey(h: string) {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export const COLUMNS = {
  dateReviewed: 'datereviewed',
  monthFolder: 'monthfolder',
  originalFilename: 'originalfilename',
  finalFilename: 'finalfilename',
  companyCode: 'companycode',
  documentType: 'documenttype',
  actionTaken: 'actiontaken',
  notifiedWho: 'notifiedwho',
  finalLocation: 'finallocation',
  status: 'status',
  boxLink: 'boxlink',
  notes: 'notes',
  // Optional, and used when present.
  amount: 'amount',
  dueDate: 'duedate',
  vendor: 'vendor',
} as const

export type RawRow = Record<string, string>

export function toRecords(rows: string[][]): { records: RawRow[]; missing: string[] } {
  const [header = [], ...body] = rows
  const keys = header.map(headerKey)

  const required = [
    COLUMNS.originalFilename,
    COLUMNS.finalFilename,
    COLUMNS.companyCode,
    COLUMNS.documentType,
    COLUMNS.actionTaken,
    COLUMNS.status,
  ]
  const missing = required.filter((r) => !keys.includes(r))

  const records = body.map((cells) => {
    const rec: RawRow = {}
    keys.forEach((k, i) => {
      rec[k] = (cells[i] ?? '').trim()
    })
    return rec
  })

  return { records, missing }
}

// ---------------------------------------------------------------------------
// Document type
// ---------------------------------------------------------------------------

/**
 * The twelve labels used in the spreadsheet, against the taxonomy in the database.
 *
 * Two decisions worth naming. "Payment Due" is a bill — it describes the same object as
 * "Bill", just with the due date in front — so both map to BILL rather than creating a
 * type whose only distinction is how the row was worded that month. And "Insurance
 * Invoice / Policy" maps to INSURANCE even though ten of the sixteen were filed under
 * Bills & Expenses, because the type says what the document *is* and the folder says
 * where it went; those are allowed to differ.
 */
export const TYPE_MAP: Record<string, string> = {
  bill: 'BILL',
  paymentdue: 'BILL',
  check: 'CHECK',
  irsnotice: 'IRS_NOTICE',
  taxnotice: 'TAX_NOTICE',
  taxprnotice: 'TAX_PR_NOTICE',
  insurance: 'INSURANCE',
  insuranceinvoicepolicy: 'INSURANCE',
  payrollw21099: 'PAYROLL',
  statement: 'STATEMENT',
  spam: 'SPAM',
  other: 'OTHER',
}

export function mapType(label: string): string | null {
  return TYPE_MAP[headerKey(label)] ?? null
}

// ---------------------------------------------------------------------------
// The decision: disposition, action kind, archive reason
// ---------------------------------------------------------------------------

export type Decision = {
  disposition: 'ARCHIVE' | 'ACTION'
  actionKind: 'PAY' | 'CONFIRM' | 'REVIEW' | null
  reason: string | null
}

/**
 * "Action Taken" decides whether the row was a decision or a filing; "Status" decides
 * whether it is finished. They are separate columns in the spreadsheet for the same
 * reason they are separate fields here.
 *
 * Only "Moved to folder" is an archive: it means the document was filed and asked
 * nothing of anybody. Everything else names a person who was handed it, which is an
 * action — even the ones marked Done, because "Cherie handled it in March" is a fact
 * worth keeping rather than flattening into "archived".
 */
const ACTION_MAP: Record<string, Omit<Decision, 'reason'>> = {
  movedtofolder: { disposition: 'ARCHIVE', actionKind: null },
  notifiedmanager: { disposition: 'ACTION', actionKind: 'CONFIRM' },
  senttocherie: { disposition: 'ACTION', actionKind: 'CONFIRM' },
  senttodanny: { disposition: 'ACTION', actionKind: 'CONFIRM' },
  resolvedeveree: { disposition: 'ACTION', actionKind: 'REVIEW' },
  pendingreview: { disposition: 'ACTION', actionKind: 'REVIEW' },
}

/**
 * Why a filed document was never shown to anyone. The database refuses an archive
 * without one, which is what makes "why wasn't I shown this?" answerable — so it is
 * derived from what the document is, and never defaulted to OTHER, which answers
 * nothing.
 */
const ARCHIVE_REASON_BY_TYPE: Record<string, string> = {
  CHECK: 'INCOMING_CHECK',
  SPAM: 'SPAM_SOLICITATION',
  STATEMENT: 'FYI_STATEMENT',
  INSURANCE: 'FYI_STATEMENT',
  PAYROLL: 'FYI_STATEMENT',
  IRS_NOTICE: 'DEADLINE_NOTICE',
  TAX_NOTICE: 'DEADLINE_NOTICE',
  TAX_PR_NOTICE: 'DEADLINE_NOTICE',
  OTHER: 'FYI_STATEMENT',
}

export function decide(actionTaken: string, typeCode: string | null): Decision | null {
  const base = ACTION_MAP[headerKey(actionTaken)]
  if (!base) return null

  if (base.disposition === 'ACTION') return { ...base, reason: null }

  /*
   * A bill that was "moved to folder" still had to be paid — the filing is what
   * happened afterwards. Recording it as an archive would put money that went out into
   * the same bucket as a statement nobody had to read.
   */
  if (typeCode === 'BILL') return { disposition: 'ACTION', actionKind: 'PAY', reason: null }

  return {
    disposition: 'ARCHIVE',
    actionKind: null,
    reason: (typeCode && ARCHIVE_REASON_BY_TYPE[typeCode]) || 'FYI_STATEMENT',
  }
}

export function mapStatus(status: string): 'WAITING' | 'DONE' | null {
  const k = headerKey(status)
  if (k === 'done' || k === 'complete' || k === 'completed') return 'DONE'
  if (k === 'waiting' || k === 'pending' || k === 'open') return 'WAITING'
  return null
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

/** "February_2026" -> 2 (1-based), or null. */
export function monthFolderNumber(label: string): number | null {
  const name = label.split(/[_\s-]/)[0]?.toLowerCase() ?? ''
  const i = MONTHS.indexOf(name)
  return i === -1 ? null : i + 1
}

export function utcDate(y: number, m: number, d: number): Date | null {
  const date = new Date(Date.UTC(y, m - 1, d))
  if (Number.isNaN(date.getTime())) return null
  // Rejects 2026-02-31, which JS would happily roll into March.
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
  return date
}

export type ReviewedDate = { date: Date | null; dayFirst: boolean; raw: string }

/**
 * The review date, with one correction applied.
 *
 * Part of the export came out day-first: thirty-one February rows read 2026-09-02 and
 * six March rows read 2026-12-03, which as written are September and December — after
 * the month whose mail they describe, and in six cases in the future. Swapping the day
 * and month puts them at 9 February and 12 March, both of which sit exactly where the
 * rest of that month's review dates sit.
 *
 * The correction is only applied when the month as written contradicts the Month Folder
 * *and* swapping resolves it. That is narrow on purpose: it cannot touch a row whose
 * date is already consistent, and it reports every row it changed.
 */
export function reviewedDate(raw: string, monthFolder: string): ReviewedDate {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw.trim())
  if (!m) return { date: null, dayFirst: false, raw }

  const year = Number(m[1])
  const a = Number(m[2])
  const b = Number(m[3])
  const folder = monthFolderNumber(monthFolder)

  // Mail from a given month is reviewed in that month or the next one.
  const plausible = (month: number) => folder === null || month === folder || month === folder + 1

  if (!plausible(a) && b <= 12 && plausible(b)) {
    const swapped = utcDate(year, b, a)
    if (swapped) return { date: swapped, dayFirst: true, raw }
  }

  return { date: utcDate(year, a, b), dayFirst: false, raw }
}

/** The `_M-D-YY_` token the naming convention puts in the middle of every final name. */
export function dateFromFilename(name: string): Date | null {
  const m = /(?:^|[_\s])(\d{1,2})-(\d{1,2})-(\d{2,4})(?:[_\s.]|$)/.exec(name)
  if (!m) return null
  let year = Number(m[3])
  if (year < 100) year += 2000
  return utcDate(year, Number(m[1]), Number(m[2]))
}

/**
 * "…_Due2-12-26" or "…_Due3-1". The year is missing more often than not, so it is taken
 * from the document's own date, rolling forward when the due month is earlier — a bill
 * dated 12 December due on the 5th is due in January.
 */
export function dueFromFilename(name: string, documentDate: Date | null): Date | null {
  const m = /due[_\s]?(\d{1,2})-(\d{1,2})(?:-(\d{2,4}))?/i.exec(name)
  if (!m) return null

  const month = Number(m[1])
  const day = Number(m[2])

  if (m[3]) {
    let year = Number(m[3])
    if (year < 100) year += 2000
    return utcDate(year, month, day)
  }

  if (!documentDate) return null
  const base = documentDate.getUTCFullYear()
  const year = month < documentDate.getUTCMonth() + 1 ? base + 1 : base
  return utcDate(year, month, day)
}

// ---------------------------------------------------------------------------
// Amount
// ---------------------------------------------------------------------------

const MONEY_RE = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)/g

/**
 * The amount, read out of the note.
 *
 * The spreadsheet has no amount column, but two thirds of the notes state one — "$995.00
 * check from Hershey Abstract" — and without it the log cannot answer a question about
 * money, which is most of what it will be asked.
 *
 * Only taken when the note contains exactly one figure. Where there are several there is
 * no way to tell the bill from the balance or the penalty, and a wrong number in a
 * financial log is worse than an empty field; those are listed in the report instead.
 */
export function amountFromNote(note: string): { amount: number | null; ambiguous: boolean } {
  const found = [...note.matchAll(MONEY_RE)].map((m) => Number(m[1].replace(/,/g, '')))
  const distinct = [...new Set(found.filter((n) => Number.isFinite(n) && n > 0))]

  if (distinct.length === 1) return { amount: distinct[0], ambiguous: false }
  return { amount: null, ambiguous: distinct.length > 1 }
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

/**
 * "CP -> Finances -> Bills & Expenses" -> ["CP", "Finances", "Bills & Expenses"].
 *
 * Both arrow forms are accepted. A slash is deliberately not a separator: one real
 * folder is called "Copies of Checks / Closing Checks (2026)", and splitting on it
 * would invent a child folder out of half of that name.
 */
export function normalizePath(location: string): string[] {
  return location
    .split(/->|>/)
    .map((p) => p.replace(/^[-\s]+|[-\s]+$/g, '').trim())
    .filter(Boolean)
}

/**
 * Repairs folder names the spreadsheet truncated at a column edge.
 *
 * Four rows say "Copies of", three say "Bills & Ex", two say "Statemer". Created as
 * written they would become three near-empty folders beside the real ones, and ten
 * documents would be filed where nobody looks.
 *
 * The evidence is frequency, not similarity, and that distinction is the whole reason
 * this works on the whole file at once rather than row by row. "Copies of" appears four
 * times and "Copies of Checks" ninety-four: the rare one is the cut-off version of the
 * common one. Matching on similarity alone would just as happily fold ninety-four
 * documents *into* the six-document folder called "Copies of Checks / Closing Checks
 * (2026)", because that name also starts with "Copies of Checks" — which is exactly what
 * an earlier version of this did.
 *
 * So a name is only ever repaired towards a sibling that is strictly more common than
 * it. Truncation is always at the end of the string, so only the last segment of a path
 * is ever a candidate.
 *
 * @param written  every (parent path, leaf name) pair in the file, as written
 * @param existing folder paths already in the database, which are never repaired away
 */
export function planFolderRepairs(
  written: { parent: string; leaf: string }[],
  existing: Set<string>,
): Map<string, string> {
  const counts = new Map<string, Map<string, number>>()
  for (const { parent, leaf } of written) {
    if (!counts.has(parent)) counts.set(parent, new Map())
    const siblings = counts.get(parent)!
    siblings.set(leaf, (siblings.get(leaf) ?? 0) + 1)
  }

  const repairs = new Map<string, string>()

  for (const [parent, siblings] of counts) {
    for (const [leaf, count] of siblings) {
      // A folder that already exists is a fact, however rare it is in this file.
      if (existing.has(`${parent} > ${leaf}`)) continue

      let best: { name: string; count: number } | null = null
      for (const [other, otherCount] of siblings) {
        if (other === leaf || otherCount <= count) continue
        if (!looksTruncated(leaf, other)) continue
        if (!best || otherCount > best.count) best = { name: other, count: otherCount }
      }
      if (best) repairs.set(`${parent}|${leaf}`, best.name)
    }
  }

  return repairs
}

/**
 * Whether `short` reads as `full` cut off at a column edge.
 *
 * A prefix covers "Copies of" and "Bills & Ex". The second clause covers "Statemer",
 * which is not a prefix of "Statements" at all — the final glyph came out wrong as well
 * as short — so one substitution is allowed, and only in the last position.
 *
 * That last restriction is load-bearing. Allowing the edit anywhere made "Tax PR" one
 * character away from "Tax IRS" and folded ten payroll-tax documents into the federal
 * tax folder. A truncation damages the end of a string; anything else is a different
 * folder with a similar name, and those are supposed to stay different.
 */
function looksTruncated(short: string, full: string): boolean {
  if (short.length >= full.length) return false
  const a = short.toLowerCase()
  const b = full.toLowerCase().slice(0, short.length)
  if (a === b) return true
  return short.length >= 5 && a.slice(0, -1) === b.slice(0, -1)
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/**
 * "Cherie + Monica & Anna", "KG", "-", "Cherie (cherie@colablending.com) + Monica & Anna
 * (monica@colabservice.com, afulgham@colabservice.com)".
 *
 * Returns the names and the addresses separately. A name is matched against users the
 * caller already loaded; nobody is invented, because a user record is an account that
 * can sign in, and creating one from a spreadsheet cell is not a thing this import gets
 * to do. Unmatched names are kept verbatim on the document and listed in the report.
 */
export function parsePeople(cell: string): { names: string[]; emails: string[] } {
  const raw = cell.trim()
  if (!raw || raw === '-' || raw === '—') return { names: [], emails: [] }

  const emails = [...raw.matchAll(/[\w.+-]+@[\w.-]+\.\w+/g)].map((m) => m[0].toLowerCase())
  const names = raw
    .replace(/\([^)]*\)/g, '')
    .split(/[+&,/]| and /i)
    .map((n) => n.trim())
    .filter((n) => n && n !== '-')

  return { names, emails }
}

/** The stem a file and a spreadsheet row are matched on: no extension, case-folded. */
export function matchKey(filename: string): string {
  return filename
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .trim()
    .toLowerCase()
}
