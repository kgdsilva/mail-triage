'use client'

import { useState } from 'react'
import { setMemberRole } from '@/server/actions/settings'
import { BTN } from '@/lib/theme'

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
}: {
  membershipId: string
  role: string
  roles: { role: string; help: string }[]
  self: boolean
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

  if (self) {
    return (
      <p className="text-[12px] text-subtle">
        This is you — another owner or admin changes your role.
      </p>
    )
  }

  return (
    <div>
      <label className="flex items-center gap-2">
        <span className="text-[12px] font-semibold text-muted">Role</span>
        <select
          value={value}
          disabled={busy}
          onChange={(e) => void change(e.target.value)}
          className={`${BTN.quiet} pr-1 lowercase`}
        >
          {roles.map((r) => (
            <option key={r.role} value={r.role}>
              {r.role.toLowerCase()}
            </option>
          ))}
        </select>
        {busy && <span className="text-[12px] text-subtle">saving…</span>}
      </label>
      {error && <p className="mt-1 text-[12px] text-danger-700">{error}</p>}
    </div>
  )
}
