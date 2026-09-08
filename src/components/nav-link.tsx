'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Banknote, Inbox, ListChecks, Settings, Table2, Upload, Wallet } from 'lucide-react'

/*
 * The icons live here rather than being passed in. A lucide icon is a component, and a
 * component cannot cross from a server component into a client one — the layout can
 * only hand over data, so it hands over a name.
 */
const ICONS = {
  queue: Inbox,
  bills: Wallet,
  review: ListChecks,
  checks: Banknote,
  log: Table2,
  upload: Upload,
  settings: Settings,
} as const

/**
 * A tab, either on the navy top bar or on a white page.
 *
 * The two need opposite ink, which is the whole reason `tone` exists: the settings tabs
 * borrowed this component, then the top bar turned navy and took its text colour with
 * it — leaving "Entities" and its neighbours in pale blue on white, effectively
 * invisible. A shared component with one colour scheme was the bug.
 *
 * The icon is not decoration: six words in a row all set in the same size read as a
 * paragraph, and an icon gives each destination a shape you can aim at without reading.
 */
export function NavLink({
  href,
  children,
  badge,
  icon,
  tone = 'bar',
}: {
  href: string
  children: React.ReactNode
  badge?: number
  icon?: keyof typeof ICONS
  /** `bar` for the navy header, `page` for tabs on a white surface. */
  tone?: 'bar' | 'page'
}) {
  const Icon = icon ? ICONS[icon] : null
  const pathname = usePathname()
  const active = href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)

  const shape =
    tone === 'bar'
      ? '-mb-px border-b-2 px-3 py-3.5 text-[13.5px]'
      : '-mb-[9px] border-b-2 px-3 pb-2.5 pt-1 text-[13.5px]'

  const colour =
    tone === 'bar'
      ? active
        ? 'border-gold-500 font-bold text-white'
        : 'border-transparent font-medium text-navy-100/75 hover:border-navy-500 hover:text-white'
      : active
        ? 'border-gold-500 font-bold text-navy-900'
        : 'border-transparent font-medium text-muted hover:border-line hover:text-navy-700'

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-1.5 transition-colors ${shape} ${colour}`}
    >
      {Icon && <Icon className="size-4 flex-none" strokeWidth={2} aria-hidden />}
      {children}
      {badge ? (
        <span
          className={`ml-0.5 rounded-full px-1.5 py-px text-[10px] font-bold ${
            tone === 'bar' ? 'bg-gold-500 text-navy-900' : 'bg-navy-700 text-white'
          }`}
        >
          {badge}
        </span>
      ) : null}
    </Link>
  )
}
