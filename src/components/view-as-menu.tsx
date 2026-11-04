'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { stopViewingAs, viewAs } from '@/server/actions/view-as'

export type Viewable = { id: string; name: string; role: string }

/**
 * The administrator's way into somebody else's view, and the way back out.
 *
 * ---------------------------------------------------------------------------
 * Why the way out is a band across the top and not a menu item
 * ---------------------------------------------------------------------------
 *
 * Because every screen in the app is about to lie to you in a quiet, convincing way: it
 * will show the approver's three tabs and no board, and nothing on it says that is not
 * your account. The thing that costs an afternoon is forgetting you are in here and
 * reporting what you saw as what you have. So the banner is unmissable, it names who you
 * are wearing, and leaving is the biggest button on it.
 *
 * It also says out loud that nothing can be changed, because the alternative is finding
 * out by pressing Approve and reading an error.
 */
export function ViewAsMenu({
  members,
  viewing,
}: {
  members: Viewable[]
  /** Who is being viewed right now, by name, or null when it is really you. */
  viewing: { name: string; realName: string } | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (viewing) {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await stopViewingAs()
            router.refresh()
          })
        }
        className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 text-[12px] font-bold text-gold-800 transition-colors hover:bg-gold-50"
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <EyeOff className="size-3.5" aria-hidden />
        )}
        Back to {viewing.realName}
      </button>
    )
  }

  if (members.length === 0) return null

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="See the app as somebody else sees it"
        className="grid size-7 place-items-center rounded-lg text-navy-100/70 transition-colors hover:bg-white/10 hover:text-white"
      >
        <Eye className="size-4" aria-hidden />
        <span className="sr-only">View as somebody else</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-64 rounded-xl border border-line bg-surface p-1.5 shadow-[0_8px_28px_rgba(18,40,74,0.28)]">
          <p className="px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-subtle">
            See the app as
          </p>
          {members.map((m) => (
            <button
              key={m.id}
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await viewAs(m.id)
                  if (!result.ok) {
                    setError(result.error ?? 'That did not work.')
                    return
                  }
                  setOpen(false)
                  // Their home screen, not whichever page this happened to be.
                  router.push(result.href ?? '/')
                })
              }
              className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] text-navy-900 transition-colors hover:bg-navy-50 disabled:opacity-50"
            >
              <span className="truncate font-semibold">{m.name}</span>
              <span className="flex-none text-[11px] font-bold uppercase tracking-wide text-subtle">
                {m.role}
              </span>
            </button>
          ))}
          <p className="mt-1 border-t border-line-soft px-2 pt-1.5 text-[11.5px] text-subtle">
            You will see exactly their screens, and be able to change nothing.
          </p>
          {error && <p className="px-2 pb-1 text-[11.5px] font-semibold text-danger-700">{error}</p>}
        </div>
      )}
    </div>
  )
}

/** The band that makes it impossible to forget. */
export function ViewAsBanner({
  name,
  role,
  realName,
}: {
  name: string
  role: string
  realName: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  return (
    <div className="bg-gold-500">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-3 gap-y-1 px-6 py-2">
        <Eye className="size-4 flex-none text-navy-900" aria-hidden />
        <p className="text-[12.5px] text-navy-900">
          <span className="font-extrabold">
            You are seeing the app as {name} ({role.toLowerCase()})
          </span>{' '}
          — this is their view, and nothing can be changed from it.
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await stopViewingAs()
              // Your own front door. The page you were on may be one the person you
              // were wearing could open and you cannot, or the other way round.
              router.push('/')
            })
          }
          className="ml-auto inline-flex flex-none items-center gap-1.5 rounded-lg bg-navy-900 px-3 py-1 text-[12px] font-bold text-white transition-colors hover:bg-navy-700 disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <EyeOff className="size-3.5" aria-hidden />
          )}
          Back to {realName}
        </button>
      </div>
    </div>
  )
}
