'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Active state is a gold underline rather than a filled block — it marks where you are
 * without turning the busiest element on screen into the darkest one.
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
      className={`-mb-px flex items-center border-b-2 px-3 py-3.5 text-[13.5px] transition-colors ${
        active
          ? 'border-gold-500 font-semibold text-navy-900'
          : 'border-transparent text-muted hover:text-navy-700'
      }`}
    >
      {children}
      {badge ? (
        <span className="ml-1.5 rounded-full bg-gold-500 px-1.5 py-px text-[10px] font-semibold text-white">
          {badge}
        </span>
      ) : null}
    </Link>
  )
}
