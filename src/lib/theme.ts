import {
  Banknote,
  Building2,
  File,
  FileText,
  Landmark,
  Receipt,
  ShieldCheck,
  TriangleAlert,
  Users,
  type LucideIcon,
} from 'lucide-react'

/**
 * Every colour decision in the app, in one file.
 *
 * The rule this follows: a hue means one thing and only one thing. Money coming in is
 * always teal, a tax authority is always plum, a bill is always gold. Colour spent
 * twice on two ideas is colour that carries neither, so a hue is claimed here once and
 * the rest of the app reads it from here.
 */

/**
 * Colour per entity, so a row is recognisable at a glance in a long log.
 *
 * Derived from the entity's code rather than hardcoded to CP/MM/OP: codes are per
 * company group, and the next group onboarded will have entirely different ones.
 *
 * It used to come from sortOrder, which quietly broke on the real data — the seeded
 * orders are 10, 20, 30, 40, 50, and modulo eight colours that put CP and OP on the
 * same plum. OP is the one entity that must never be mistaken for another. A code is
 * also stable under re-ordering, which a position is not.
 *
 * Written out rather than built from a hue name: Tailwind generates utilities by
 * scanning the source text, so `bg-${hue}-100` would compile to a class that does not
 * exist in the stylesheet. Every colour used anywhere has to appear literally.
 */
const ENTITY_STYLES = [
  { pill: 'bg-navy-100 text-navy-900', bar: 'bg-navy-500' },
  { pill: 'bg-teal-100 text-teal-700', bar: 'bg-teal-500' },
  { pill: 'bg-plum-100 text-plum-700', bar: 'bg-plum-500' },
  { pill: 'bg-moss-100 text-moss-700', bar: 'bg-moss-500' },
  { pill: 'bg-gold-100 text-gold-800', bar: 'bg-gold-500' },
  { pill: 'bg-sky-100 text-sky-700', bar: 'bg-sky-500' },
  { pill: 'bg-clay-100 text-clay-700', bar: 'bg-clay-500' },
  { pill: 'bg-violet-100 text-violet-700', bar: 'bg-violet-500' },
] as const

function entityStyle(code: string | null | undefined, fallback = 0) {
  if (code) {
    let sum = 0
    for (let i = 0; i < code.length; i += 1) sum += code.charCodeAt(i)
    return ENTITY_STYLES[sum % ENTITY_STYLES.length]
  }
  // Guards against a negative or absurd sortOrder rather than returning undefined.
  const safe = Number.isFinite(fallback) ? Math.abs(Math.trunc(fallback)) : 0
  return ENTITY_STYLES[safe % ENTITY_STYLES.length]
}

/** The entity's tag: its code on its own colour. */
export function entityColor(code: string | null | undefined, fallback = 0) {
  return entityStyle(code, fallback).pill
}

/**
 * The same colour as a solid bar, for the left edge of a card. Reading a queue is
 * mostly "which company is this?", and an edge answers that from further away than a
 * pill does.
 */
export function entityAccent(code: string | null | undefined, fallback = 0) {
  return entityStyle(code, fallback).bar
}

/**
 * Icon and colour per document type, for scanning a screen without reading every line.
 *
 * Keyed on the type's code with a generic fallback, because document types are editable
 * per company group — a type someone adds later still renders, just without a bespoke
 * icon or colour.
 */
const TYPES: Record<string, { Icon: LucideIcon; tone: string; ink: string }> = {
  // Money out.
  BILL: { Icon: Receipt, tone: 'bg-gold-100 text-gold-800', ink: 'text-gold-600' },
  // Money in — the one bucket that is good news, and the only teal on the screen.
  CHECK: { Icon: Banknote, tone: 'bg-teal-100 text-teal-700', ink: 'text-teal-500' },
  // Authorities. Plum for the federal one, clay and violet for the local and payroll
  // ones, so three notices in a row do not blur into one.
  IRS_NOTICE: { Icon: Landmark, tone: 'bg-plum-100 text-plum-700', ink: 'text-plum-500' },
  TAX_NOTICE: { Icon: Building2, tone: 'bg-clay-100 text-clay-700', ink: 'text-clay-500' },
  TAX_PR_NOTICE: { Icon: Users, tone: 'bg-violet-100 text-violet-700', ink: 'text-violet-500' },
  INSURANCE: { Icon: ShieldCheck, tone: 'bg-sky-100 text-sky-700', ink: 'text-sky-500' },
  STATEMENT: { Icon: FileText, tone: 'bg-navy-100 text-navy-900', ink: 'text-navy-500' },
  // Spam should read as a warning, not as a category.
  SPAM: { Icon: TriangleAlert, tone: 'bg-danger-100 text-danger-700', ink: 'text-danger-500' },
  OTHER: { Icon: File, tone: 'bg-line-soft text-muted', ink: 'text-subtle' },
}

const FALLBACK_TYPE = { Icon: File, tone: 'bg-line-soft text-muted', ink: 'text-subtle' }

export function documentTypeIcon(code: string | null | undefined): LucideIcon {
  return ((code && TYPES[code]) || FALLBACK_TYPE).Icon
}

export function documentTypeTone(code: string | null | undefined) {
  return ((code && TYPES[code]) || FALLBACK_TYPE).tone
}

/** The same colour as ink, for a bare icon in a dense table where a tile is too heavy. */
export function documentTypeInk(code: string | null | undefined) {
  return ((code && TYPES[code]) || FALLBACK_TYPE).ink
}

/**
 * What the document is asking of someone. Not a person's job title — who pays and who
 * confirms changes document by document — so these colour the ask, not the owner.
 */
export const ACTION_KINDS = {
  PAY: { label: 'To pay', tone: 'bg-gold-100 text-gold-800', dot: 'bg-gold-500' },
  CONFIRM: { label: 'To confirm', tone: 'bg-violet-100 text-violet-700', dot: 'bg-violet-500' },
  REVIEW: { label: 'To review', tone: 'bg-sky-100 text-sky-700', dot: 'bg-sky-500' },
} as const

/**
 * How close a due date is, as a colour. Overdue is the only red on a bill screen, which
 * is what keeps red meaning "today, not this week".
 */
export function urgency(due: string | null): 'overdue' | 'soon' | 'later' | 'none' {
  if (!due) return 'none'
  const today = new Date().toISOString().slice(0, 10)
  if (due < today) return 'overdue'
  const week = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)
  return due <= week ? 'soon' : 'later'
}

export const URGENCY_TONE = {
  overdue: 'bg-danger-100 text-danger-700',
  soon: 'bg-gold-100 text-gold-800',
  later: 'bg-sky-100 text-sky-700',
  none: 'bg-line-soft text-muted',
} as const

export const URGENCY_BAR = {
  overdue: 'bg-danger-500',
  soon: 'bg-gold-500',
  later: 'bg-sky-500',
  none: 'bg-line',
} as const

/** Shared shape tokens, so a card on one screen matches a card on another. */
export const CARD = 'rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(18,40,74,0.05)]'
export const INPUT =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-subtle outline-none transition-colors focus:border-navy-500'
/**
 * Buttons.
 *
 * Each one changes colour on hover *and* again on :active, so a click is confirmed by
 * the button itself rather than only by whatever happens next. The global stylesheet
 * adds the pixel of travel and the hand cursor.
 */
export const BTN = {
  primary:
    'inline-flex items-center justify-center gap-1.5 rounded-lg bg-navy-700 px-3.5 py-2 text-[13px] font-semibold text-white shadow-[0_1px_1px_rgba(18,40,74,0.15)] transition-colors hover:bg-navy-900 active:bg-navy-900 active:shadow-none disabled:opacity-50 disabled:shadow-none',
  secondary:
    'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3.5 py-2 text-[13px] font-semibold text-navy-700 transition-colors hover:border-navy-500 hover:bg-navy-50 active:bg-navy-100 disabled:opacity-50',
  ghost:
    'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-muted transition-colors hover:bg-navy-50 hover:text-navy-700 active:bg-navy-100 disabled:opacity-50',
  /** Finishing something is the good outcome, so it gets the only green button. */
  done:
    'inline-flex items-center justify-center gap-1.5 rounded-lg bg-ok-700 px-3.5 py-2 text-[13px] font-semibold text-white shadow-[0_1px_1px_rgba(18,40,74,0.15)] transition-colors hover:bg-[#155538] active:bg-[#0f3f29] active:shadow-none disabled:opacity-50 disabled:shadow-none',
  quiet:
    'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] font-medium text-muted transition-colors hover:border-navy-500 hover:bg-navy-50 hover:text-navy-700 active:bg-navy-100 disabled:opacity-50',
  /** For a destructive row action: quiet until you are over it. */
  danger:
    'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] font-medium text-muted transition-colors hover:border-danger-500 hover:bg-danger-100 hover:text-danger-700 active:bg-danger-100 disabled:opacity-50',
} as const
