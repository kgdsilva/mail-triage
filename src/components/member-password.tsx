'use client'

import { useState, useTransition } from 'react'
import { Check, KeyRound, ShieldCheck, X } from 'lucide-react'
import { setMemberPassword } from '@/server/actions/settings'
import { PasswordField } from '@/components/password-field'
import { BTN } from '@/lib/theme'

/**
 * Setting or replacing one member's password.
 *
 * The password is shown, not masked, and it stays on screen after saving until it is
 * dismissed — because the whole reason an admin sets one is to tell somebody what it
 * is, and there is no reset email to fall back on.
 *
 * What it cannot do is show a password set last month. Those are stored as a scrypt
 * hash, which is one-way by construction: the database holds enough to check a password
 * and not enough to reproduce one, and that is what stops a copy of the database being
 * a list of everyone's credentials. So the way back from "nobody remembers it" is a new
 * one, which Generate makes a two-second job.
 */
export function MemberPassword({
  membershipId,
  email,
  hasPassword,
}: {
  membershipId: string
  email: string
  hasPassword: boolean
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function save(password: string) {
    setError(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.set('password', password)
      try {
        await setMemberPassword(membershipId, fd)
        setSaved(password || null)
        setValue('')
        setOpen(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save that password.')
      }
    })
  }

  if (saved) {
    return (
      <div className="rounded-lg border border-ok-700/25 bg-ok-100 p-3">
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 size-4 flex-none text-ok-700" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-bold text-ok-700">Password set — copy it now</p>
            <p className="mt-0.5 text-[12px] text-ok-700/85">
              Hand this to {email} yourself. It cannot be read back later, but you can
              always generate a new one.
            </p>
            <p className="mt-2 select-all rounded border border-ok-700/25 bg-surface px-2 py-1.5 font-mono text-[14px] font-semibold tracking-tight text-ink">
              {saved}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSaved(null)}
            aria-label="Dismiss"
            className="grid size-6 flex-none place-items-center rounded text-ok-700 transition-colors hover:bg-surface"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>
    )
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            hasPassword ? 'bg-navy-100 text-navy-900' : 'bg-line-soft text-muted'
          }`}
        >
          <KeyRound className="size-3" aria-hidden />
          {hasPassword ? 'Password or Google' : 'Google only'}
        </span>
        <button type="button" onClick={() => setOpen(true)} className={BTN.quiet}>
          {hasPassword ? 'Change password' : 'Set a password'}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-lg border border-line bg-canvas p-2.5">
      <PasswordField
        value={value}
        onChange={setValue}
        placeholder="Type one, or press Generate"
        compact
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => save(value)}
          disabled={pending || value.trim().length === 0}
          className={BTN.done}
        >
          <Check className="size-3.5" aria-hidden />
          {pending ? 'Saving…' : 'Save password'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setValue('')
            setError(null)
          }}
          className={BTN.quiet}
        >
          Cancel
        </button>
        {hasPassword && (
          <button
            type="button"
            onClick={() => save('')}
            disabled={pending}
            className="ml-auto text-[12px] font-medium text-muted underline transition-colors hover:text-danger-700"
            title="Leaves Google as the only way in — it does not remove access."
          >
            Remove the password
          </button>
        )}
      </div>
      {error && <p className="text-[12px] font-semibold text-danger-700">{error}</p>}
    </div>
  )
}
