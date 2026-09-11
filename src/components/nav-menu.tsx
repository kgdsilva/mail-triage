'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useState } from 'react'
import {
  Banknote,
  ChevronDown,
  DatabaseBackup,
  Inbox,
  ListChecks,
  Receipt,
  Settings,
  Table2,
  Upload,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { useDismiss } from '@/components/use-dismiss'

const ICONS: Record<string, LucideIcon> = {
  queue: Inbox,
  bills: Wallet,
  paid: Receipt,
  checks: Banknote,
  review: ListChecks,
  upload: Upload,
  log: Table2,
  import: DatabaseBackup,
  settings: Settings,
}

export type NavItem = {
  href: string
  label: string
  /** What this screen is for, in one line. The reason the menus exist at all. */
  blurb: string
  icon: keyof typeof ICONS
  badge?: number
}

export type NavGroup = {
  label: string
  /** Rendered flat when it holds one item — a menu with one choice is furniture. */
  items: NavItem[]
}

/**
 * The top bar: two named menus and two plain links.
 *
 * Seven tabs in a row was the problem. Each was a bare word, and "Bills", "Checks",
 * "Review" and "Master log" do not explain themselves — people could read the whole bar
 * and still not know which one answers their question. A flat row has nowhere to put
 * that explanation, which is really why it is grouped now: a menu can carry a sentence
 * under each item, and the group's own name says what kind of question it answers.
 *
 * Money is what moves; Mail is what arrives. My queue stays flat because it is the
 * home, and Settings because it is not part of the daily work.
 */
export function NavMenu({ groups }: { groups: NavGroup[] }) {
  /*
   * One open menu at a time, owned here rather than by each menu.
   *
   * These were native <details> elements, which only close by clicking the same summary
   * again — so clicking away left the menu hanging, opening a second one gave you two,
   * and going to a page left the menu it came from covering the page you had arrived at.
   * Every one of those is the same missing idea: a dropdown belongs to the bar, not to
   * itself, and the bar is what knows one is open.
   */
  const [open, setOpen] = useState<string | null>(null)
  const pathname = usePathname()
  const close = useCallback(() => setOpen(null), [])
  const bar = useDismiss<HTMLElement>(open !== null, close)

  /*
   * Arriving somewhere closes the menu you left from — including on back and forward,
   * which no click handler sees.
   *
   * Adjusted during render rather than in an effect: the menu has to be gone in the same
   * paint as the new page, and an effect would leave it over the page for a frame.
   */
  const [seenPath, setSeenPath] = useState(pathname)
  if (seenPath !== pathname) {
    setSeenPath(pathname)
    setOpen(null)
  }

  return (
    <nav ref={bar} className="ml-auto flex items-stretch gap-0.5">
      {groups.map((group) =>
        group.items.length === 1 ? (
          <FlatLink key={group.label} item={group.items[0]} />
        ) : (
          <Menu
            key={group.label}
            group={group}
            open={open === group.label}
            anyOpen={open !== null}
            onToggle={() => setOpen((v) => (v === group.label ? null : group.label))}
            onOpen={() => setOpen(group.label)}
            onClose={() => setOpen(null)}
          />
        ),
      )}
    </nav>
  )
}

function useActive(href: string) {
  const pathname = usePathname()
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)
}

function FlatLink({ item }: { item: NavItem }) {
  const active = useActive(item.href)
  const Icon = ICONS[item.icon]

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      title={item.blurb}
      className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-3.5 text-[13.5px] transition-colors ${
        active
          ? 'border-gold-500 font-bold text-white'
          : 'border-transparent font-medium text-navy-100/75 hover:border-navy-500 hover:text-white'
      }`}
    >
      <Icon className="size-4 flex-none" strokeWidth={2} aria-hidden />
      {item.label}
      <Badge count={item.badge} />
    </Link>
  )
}

function Menu({
  group,
  open,
  anyOpen,
  onToggle,
  onOpen,
  onClose,
}: {
  group: NavGroup
  open: boolean
  /** True while some menu is open — including another one. */
  anyOpen: boolean
  onToggle: () => void
  onOpen: () => void
  onClose: () => void
}) {
  const pathname = usePathname()
  const active = group.items.some((i) =>
    i.href === '/' ? pathname === '/' : pathname === i.href || pathname.startsWith(`${i.href}/`),
  )
  // A badge inside a closed menu is a badge nobody sees, so it surfaces on the group.
  const badge = group.items.reduce((sum, i) => sum + (i.badge ?? 0), 0)

  return (
    <div className="relative flex">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={onToggle}
        /*
         * Hover switches menus, but only while one is already open. Sliding across the
         * bar with a menu engaged should move with you; hovering the bar when nothing is
         * open should not throw a panel over the page you are reading.
         */
        onPointerEnter={(e) => {
          if (anyOpen && !open && e.pointerType === 'mouse') onOpen()
        }}
        className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-3.5 text-[13.5px] transition-colors ${
          open ? 'bg-navy-700 ' : ''
        }${
          active
            ? 'border-gold-500 font-bold text-white'
            : 'border-transparent font-medium text-navy-100/75 hover:border-navy-500 hover:text-white'
        }`}
      >
        {group.label}
        <Badge count={badge} />
        <ChevronDown
          className={`size-3.5 flex-none opacity-70 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 w-[19rem] overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-[0_8px_24px_rgba(18,40,74,0.18)]"
        >
          {group.items.map((item) => (
            // Choosing an item closes the menu now rather than when the page arrives, so
            // it never sits over the screen it just sent you to.
            <MenuItem key={item.href} item={item} onNavigate={onClose} />
          ))}
        </div>
      )}
    </div>
  )
}

function MenuItem({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const active = useActive(item.href)
  const Icon = ICONS[item.icon]

  return (
    <Link
      href={item.href}
      role="menuitem"
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-navy-50 active:bg-navy-100 ${
        active ? 'bg-navy-50' : ''
      }`}
    >
      <span
        className={`mt-0.5 grid size-7 flex-none place-items-center rounded-lg ${
          active ? 'bg-navy-700 text-white' : 'bg-navy-50 text-navy-700'
        }`}
        aria-hidden
      >
        <Icon className="size-4" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13.5px] font-bold text-navy-900">
          {item.label}
          <Badge count={item.badge} tone="page" />
        </span>
        <span className="mt-0.5 block text-[12px] leading-snug text-muted">{item.blurb}</span>
      </span>
    </Link>
  )
}

function Badge({ count, tone = 'bar' }: { count?: number; tone?: 'bar' | 'page' }) {
  if (!count) return null
  return (
    <span
      className={`rounded-full px-1.5 py-px text-[10px] font-bold ${
        tone === 'bar' ? 'bg-gold-500 text-navy-900' : 'bg-navy-700 text-white'
      }`}
    >
      {count}
    </span>
  )
}
