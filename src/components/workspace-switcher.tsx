'use client'

import { useCallback, useState, useTransition } from 'react'
import { Building2, Check, ChevronDown, User } from 'lucide-react'
import { switchWorkspace } from '@/server/actions/workspace'
import { useDismiss } from '@/components/use-dismiss'

export type SwitcherWorkspace = { id: string; name: string; slug: string }

/**
 * Which world you are in, at the top left, next to the product name.
 *
 * Not another row of tabs. The nav below already uses tabs for *destinations*, and this
 * changes what "the log" and "my queue" even mean — the same words point at different
 * documents in each workspace. So it sits beside the brand, where a context control
 * belongs, and reads as the thing everything else hangs off.
 *
 * One workspace renders as plain text: a switcher offering a single choice is furniture.
 */
export function WorkspaceSwitcher({
  workspaces,
  activeId,
}: {
  workspaces: SwitcherWorkspace[]
  activeId: string
}) {
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const box = useDismiss<HTMLDivElement>(open, close)
  const active = workspaces.find((w) => w.id === activeId)

  if (workspaces.length <= 1) {
    return (
      <span className="hidden text-[12.5px] font-medium text-navy-100/70 sm:inline">
        {active?.name}
      </span>
    )
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px] font-semibold text-white/90 transition-colors hover:bg-navy-700"
      >
        <Icon slug={active?.slug} />
        <span className="max-w-[13rem] truncate">{active?.name}</span>
        <ChevronDown
          className={`size-3.5 flex-none opacity-70 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-20 mt-1 w-72 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-[0_8px_24px_rgba(18,40,74,0.18)]"
        >
          <p className="px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-subtle">
            Workspace
          </p>
          {workspaces.map((w) => {
            const current = w.id === activeId
            return (
              <button
                key={w.id}
                type="button"
                disabled={pending || current}
                onClick={() => {
                  // Closed before the switch, not after: switching reloads everything,
                  // and a panel still up during that reads as the click not landing.
                  setOpen(false)
                  startTransition(() => switchWorkspace(w.id))
                }}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors ${
                  current
                    ? 'font-bold text-navy-900'
                    : 'font-medium text-ink hover:bg-navy-50 active:bg-navy-100'
                }`}
              >
                <span
                  className={`grid size-7 flex-none place-items-center rounded-lg ${
                    current ? 'bg-navy-700 text-white' : 'bg-navy-50 text-navy-700'
                  }`}
                  aria-hidden
                >
                  <Icon slug={w.slug} />
                </span>
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                {current && <Check className="size-4 flex-none text-navy-700" aria-hidden />}
              </button>
            )
          })}
          <p className="border-t border-line-soft px-3 py-2 text-[11.5px] leading-relaxed text-subtle">
            Each workspace keeps its own companies, document types and log. Nothing
            crosses between them.
          </p>
        </div>
      )}
    </div>
  )
}

/** A building for the businesses, a person for the personal side. */
function Icon({ slug }: { slug: string | undefined }) {
  const Glyph = slug === 'megan-personal' ? User : Building2
  return <Glyph className="size-4 flex-none" strokeWidth={2} aria-hidden />
}
