/**
 * Standard file naming, e.g. CP_06-01-26_JumpCloud_Technology_255.pdf
 *
 * The point of a convention this strict is that nobody has to remember which folder
 * something went in — the name carries the answer, so searching replaces browsing. That
 * only works if every field a person would search by is actually in it, which is why
 * vendor and category were added: "everything we paid JumpCloud" and "every technology
 * invoice" were both unanswerable from a name that had neither.
 *
 * Entity first, because an accountant reconciling one company wants to see at a glance
 * which bills are not theirs, and a sorted directory then groups by company for free.
 *
 * The template lives in CompanyGroup.settings so a different group can adopt a different
 * convention. Always a *suggestion* — the operator edits it before it commits.
 */

export type NameParts = {
  entityCode: string | null
  documentDate: Date | null
  typeLabel: string | null
  /** The vendor's canonical name, already resolved through its aliases. */
  vendorName?: string | null
  /** What the money was for. */
  categoryName?: string | null
  amount: number | null
  extension: string
}

function formatDate(date: Date, pattern: string) {
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const yy = String(date.getUTCFullYear()).slice(-2)
  const yyyy = String(date.getUTCFullYear())
  return pattern
    .replace('YYYY', yyyy)
    .replace('MM', mm)
    .replace('DD', dd)
    .replace('YY', yy)
}

/** Whole dollars stay whole (255), cents are kept when present (255.50). */
function formatAmount(amount: number) {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2)
}

export function suggestFilename(
  parts: NameParts,
  settings: { filenameTemplate?: string; dateFormat?: string } = {},
) {
  const template = settings.filenameTemplate ?? '{entity}_{date}_{vendor}_{category}_{amount}'
  const dateFormat = settings.dateFormat ?? 'MM-DD-YY'

  const values: Record<string, string> = {
    entity: parts.entityCode ?? '',
    date: parts.documentDate ? formatDate(parts.documentDate, dateFormat) : '',
    // Spaces and punctuation out: "Tax / PR Notice" -> "TaxPRNotice".
    type: (parts.typeLabel ?? '').replace(/[^A-Za-z0-9]+/g, ''),
    vendor: (parts.vendorName ?? '').replace(/[^A-Za-z0-9]+/g, ''),
    // "Office/Rent" -> "OfficeRent". The slash would otherwise read as a directory.
    category: (parts.categoryName ?? '').replace(/[^A-Za-z0-9]+/g, ''),
    amount: parts.amount != null ? formatAmount(parts.amount) : '',
  }

  const stem = template
    .replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '')
    // Drop separators left stranded by an empty field, rather than emitting "CP__255".
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')

  const ext = parts.extension.replace(/^\.+/, '').toLowerCase() || 'pdf'
  return `${stem || 'untitled'}.${ext}`
}
