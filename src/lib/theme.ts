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
 * Colour per entity, so a row is recognisable at a glance in a long log.
 *
 * Assigned by position rather than hardcoded to CP/MM/OP: entity codes are per company
 * group, and the next group onboarded will have entirely different ones. Position comes
 * from the entity's sortOrder, so the mapping is stable for a given group and any new
 * group gets colours for free.
 */
const ENTITY_COLORS = [
  'bg-navy-100 text-navy-900',
  'bg-[#d7ede7] text-[#0b4a3c]',
  'bg-[#e4dff1] text-[#3a2c63]',
  'bg-[#f5dfe8] text-[#6b2244]',
  'bg-gold-100 text-gold-800',
  'bg-[#dce9f7] text-[#14456f]',
  'bg-[#f0e6da] text-[#6b4423]',
  'bg-[#e0eddb] text-[#395a2b]',
] as const

export function entityColor(index: number) {
  // Guards against a negative or absurd sortOrder rather than returning undefined.
  const safe = Number.isFinite(index) ? Math.abs(Math.trunc(index)) : 0
  return ENTITY_COLORS[safe % ENTITY_COLORS.length]
}

/**
 * Icon per document type, for scanning a screen without reading every line.
 *
 * Keyed on the type's code with a generic fallback, because document types are editable
 * per company group — a type someone adds later still renders, just without a bespoke
 * icon.
 */
const TYPE_ICONS: Record<string, LucideIcon> = {
  BILL: Receipt,
  TAX_NOTICE: Building2,
  IRS_NOTICE: Landmark,
  TAX_PR_NOTICE: Users,
  CHECK: Banknote,
  INSURANCE: ShieldCheck,
  STATEMENT: FileText,
  SPAM: TriangleAlert,
  OTHER: File,
}

export function documentTypeIcon(code: string | null | undefined): LucideIcon {
  return (code && TYPE_ICONS[code]) || File
}

/** Spam is the one type whose icon should read as a warning, not as a category. */
export function documentTypeTone(code: string | null | undefined) {
  return code === 'SPAM'
    ? 'bg-danger-100 text-danger-700'
    : 'bg-navy-50 text-navy-700'
}

/** Shared shape tokens, so a card on one screen matches a card on another. */
export const CARD = 'rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(18,40,74,0.05)]'
export const INPUT =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-subtle outline-none transition-colors focus:border-navy-500'
export const BTN = {
  primary:
    'inline-flex items-center justify-center gap-1.5 rounded-lg bg-navy-700 px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-navy-900 disabled:opacity-50',
  secondary:
    'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-navy-700 transition-colors hover:border-navy-500 hover:bg-navy-50',
  ghost:
    'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-muted transition-colors hover:bg-navy-50 hover:text-navy-700',
} as const
