'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { setMemberRole } from '@/server/actions/settings'

/**
 * Changing what somebody may do, on their own row.
 *
 * A select that saves on change rather than a select plus a Save button: there is one
 * field, and a role sitting changed-but-unsaved is worse than either state. The error is
 * shown in place — the refusals it can hit (your own role, the last owner) are things a
 * person needs to read, not a silent no-op.
 */
export function MemberRole({
  membershipId,
  role,
  roles,
  self,
  tone,
}: {
  membershipId: string
  role: string
  roles: { role: string; help: string }[]
  self: boolean
  /** Colour by weight, so the list still reads by how much someone can do. */
  tone: Record<string, string>
}) {
  const [value, setValue] = useState(role)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function change(next: string) {
    const previous = value
    setValue(next)
    setBusy(true)
    setError(null)
    try {
      await setMemberRole(membershipId, next)
    } catch (err) {
      setValue(previous)
      setError(err instanceof Error ? err.message : 'Could not change the role.')
    } finally {
      setBusy(false)
    }
  }

  const badge = `rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
    tone[value] ?? 'bg-line-soft text-muted'
  }`

  /*
   * Your own role is a badge and not a control. Nothing stops an owner locking
   * themselves out of Settings faster than a one-click dropdown on their own row, and
   * the server refuses it anyway — so the refusal is shown as an absence rather than as
   * an error after the fact.
   */
  if (self) {
    return (
      <span className={badge} title="Another owner or admin changes your role">
        {value.toLowerCase()}
      </span>
    )
  }

  /*
   * The badge *is* the control. It was a coloured badge next to a dropdown showing the
   * same word twice, which reads as a label beside an unrelated setting; one thing that
   * looks like the role and changes the role is less to understand. It saves on change
   * rather than behind a Save button, because a role sitting changed-but-unsaved is
   * worse than either state.
   */
  return (
    <span className="relative inline-flex items-center gap-1">
      <select
        value={value}
        disabled={busy}
        onChange={(e) => void change(e.target.value)}
        aria-label="Role"
        className={`${badge} appearance-none pr-5 lowercase outline-none focus:ring-2 focus:ring-navy-500`}
      >
        {roles.map((r) => (
          <option key={r.role} value={r.role} className="normal-case">
            {r.role.toLowerCase()}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 size-3 opacity-60" aria-hidden />
      {busy && <span className="ml-1 text-[11px] text-subtle">saving…</span>}
      {error && (
        <span className="ml-1 text-[11px] font-semibold text-danger-700" role="alert">
          {error}
        </span>
      )}
    </span>
  )
}
