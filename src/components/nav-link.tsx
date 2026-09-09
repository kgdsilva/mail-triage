'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * A tab on a white page — the settings sub-navigation.
 *
 * The top bar used to share this component, which is how the settings tabs ended up
 * pale blue on white when that bar turned navy. The bar is `NavMenu` now, and this is
 * only ever drawn on a light surface, so there is one colour scheme again.
 */
export function NavLink({
  href,
  children,
  badge,
}: {
  href: string
  children: React.ReactNode
  badge?: number
}) {
  const pathname = usePathname()
  const active = href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`-mb-[9px] flex items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-1 text-[13.5px] transition-colors ${
        active
          ? 'border-gold-500 font-bold text-navy-900'
          : 'border-transparent font-medium text-muted hover:border-line hover:text-navy-700'
      }`}
    >
      {children}
      {badge ? (
        <span className="ml-0.5 rounded-full bg-navy-700 px-1.5 py-px text-[10px] font-bold text-white">
          {badge}
        </span>
      ) : null}
    </Link>
  )
}
