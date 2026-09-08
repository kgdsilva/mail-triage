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
 * One tab in the top bar, on the navy band.
 *
 * Active state is a gold underline plus white text. The icon is not decoration: six
 * words in a row all set in the same size read as a paragraph, and an icon gives each
 * destination a shape you can aim at without reading.
 */
export function NavLink({
  href,
  children,
  badge,
  icon,
}: {
  href: string
  children: React.ReactNode
  badge?: number
  icon?: keyof typeof ICONS
}) {
  const Icon = icon ? ICONS[icon] : null
  const pathname = usePathname()
  const active = href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-3.5 text-[13.5px] transition-colors ${
        active
          ? 'border-gold-500 font-bold text-white'
          : 'border-transparent font-medium text-navy-100/75 hover:border-navy-500 hover:text-white'
      }`}
    >
      {Icon && <Icon className="size-4 flex-none" strokeWidth={2} aria-hidden />}
      {children}
      {badge ? (
        <span className="ml-0.5 rounded-full bg-gold-500 px-1.5 py-px text-[10px] font-bold text-navy-900">
          {badge}
        </span>
      ) : null}
    </Link>
  )
}
