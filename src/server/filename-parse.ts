import { prisma } from '@/server/db/client'

/**
 * Scans arrive already individually named, e.g. "MUNAR_7-5-26_Berkheimer payment.pdf".
 * Those names are informal and inconsistent, but they usually carry an entity hint and
 * a date, and pre-filling them saves the operator two fields on every document.
 *
 * Everything here is a *guess* shown in an editable field. A wrong guess costs a
 * keystroke; it never commits.
 */

export type ParsedName = {
  entityId: string | null
  entityGuessText: string | null
  documentDate: Date | null
  /** Leftover words, offered as a starting point for the vendor field. */
  remainder: string | null
}

/** Matches 7-5-26, 07-05-2026, 7.5.26 and 7/5/26. Month-first, US convention. */
const DATE_RE = /(\d{1,2})[-._/](\d{1,2})[-._/](\d{2,4})/

function parseDate(text: string): Date | null {
  const m = DATE_RE.exec(text)
  if (!m) return null

  const month = Number(m[1])
  const day = Number(m[2])
  let year = Number(m[3])
  if (year < 100) year += 2000

  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  // UTC: these are calendar dates stored in a `date` column, and constructing them in
  // local time would shift them a day for anyone west of UTC.
  const date = new Date(Date.UTC(year, month - 1, day))
  return Number.isNaN(date.getTime()) ? null : date
}

export async function parseIncomingFilename(
  companyGroupId: string,
  filename: string,
): Promise<ParsedName> {
  const stem = filename.replace(/\.[^.]+$/, '')
  const documentDate = parseDate(stem)

  const tokens = stem.split(/[_\s]+/).filter(Boolean)
  const head = tokens[0] ?? ''
  const normalized = head.toUpperCase().replace(/[^A-Z0-9]/g, '')

  const entities = await prisma.entity.findMany({
    where: { companyGroupId, isActive: true },
    include: { aliases: true },
  })

  // Exact code match first — the convention we are moving people toward.
  let matched = entities.find((e) => e.code.toUpperCase() === normalized) ?? null

  // Then legal name or alias containing the token. Only accepted when exactly one
  // entity matches: "MUNAR" hits both Marsh & Munar and Marsh & Munar Team, and
  // guessing between them would be worse than leaving the field empty.
  if (!matched && normalized.length >= 3) {
    const candidates = entities.filter((e) => {
      const haystack = [e.legalName, e.displayName ?? '', ...e.aliases.map((a) => a.aliasText)]
        .join(' ')
        .toUpperCase()
        .replace(/[^A-Z0-9 ]/g, '')
      return haystack.includes(normalized)
    })
    if (candidates.length === 1) matched = candidates[0]
  }

  const remainder = tokens
    .slice(1)
    .filter((t) => !DATE_RE.test(t))
    .join(' ')
    .trim()

  return {
    entityId: matched?.id ?? null,
    entityGuessText: matched ? null : head || null,
    documentDate,
    remainder: remainder || null,
  }
}
