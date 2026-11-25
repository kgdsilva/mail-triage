'use client'

import { useState } from 'react'
import { setMemberHome } from '@/server/actions/settings'

/**
 * Which screen this person lands on after signing in.
 *
 * Blank means the role decides, which is what almost everybody wants and what every row
 * says today. It is offered per person because two administrators can want opposite
 * things — one runs the office and needs the shared board, the other owns the companies
 * and wants to be told only when something is broken.
 *
 * Only the screens that person's role can actually open are offered. A home they cannot
 * reach would bounce them straight back out, which is the thing this setting exists to
 * stop, recreated by the setting.
 */
export function MemberHome({
  membershipId,
  homePath,
  choices,
  roleDefault,
}: {
  membershipId: string
  homePath: string | null
  choices: { path: string; label: string }[]
  /** What the role would choose on its own, named so the blank option can say it. */
  roleDefault: string
}) {
  const [value, setValue] = useState(homePath ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function change(next: string) {
    const previous = value
    setValue(next)
    setBusy(true)
    setError(null)
    const res = await setMemberHome(membershipId, next)
    if (!res.ok) {
      setValue(previous)
      setError(res.error)
    }
    setBusy(false)
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <select
        value={value}
        disabled={busy}
        onChange={(e) => void change(e.target.value)}
        aria-label="Signs in to"
        className="rounded-lg border border-line bg-surface px-2 py-1 text-[12.5px] outline-none focus:border-navy-500"
      >
        <option value="">{roleDefault} (default for the role)</option>
        {choices.map((c) => (
          <option key={c.path} value={c.path}>
            {c.label}
          </option>
        ))}
      </select>
      {busy && <span className="text-[11px] text-subtle">saving…</span>}
      {error && (
        <span className="text-[11px] font-semibold text-danger-700" role="alert">
          {error}
        </span>
      )}
    </span>
  )
}
