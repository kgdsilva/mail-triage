/**
 * Standard file naming, e.g. CP_06-01-26_IRSNotice_255.pdf
 *
 * The template lives in CompanyGroup.settings so a different group can adopt a
 * different convention. Always a *suggestion* — the operator edits it before it commits.
 */

export type NameParts = {
  entityCode: string | null
  documentDate: Date | null
  typeLabel: string | null
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
  const template = settings.filenameTemplate ?? '{entity}_{date}_{type}_{amount}'
  const dateFormat = settings.dateFormat ?? 'MM-DD-YY'

  const values: Record<string, string> = {
    entity: parts.entityCode ?? '',
    date: parts.documentDate ? formatDate(parts.documentDate, dateFormat) : '',
    // Spaces and punctuation out: "Tax / PR Notice" -> "TaxPRNotice".
    type: (parts.typeLabel ?? '').replace(/[^A-Za-z0-9]+/g, ''),
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
