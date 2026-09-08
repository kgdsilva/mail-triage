'use client'

import { useState, useTransition } from 'react'
import { ShieldCheck, UserPlus, X } from 'lucide-react'
import { addMember } from '@/server/actions/settings'
import { PasswordField } from '@/components/password-field'
import { BTN, INPUT } from '@/lib/theme'

/**
 * Adding somebody to the allowlist.
 *
 * The password, if there is one, stays on screen after the member is created — there is
 * no invitation email and no reset link, so the one moment it can be read is now, and a
 * form that cleared itself was throwing away the only copy.
 */
export function AddMemberForm({ roles }: { roles: { role: string; help: string }[] }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('MEMBER')
  const [password, setPassword] = useState('')
  const [created, setCreated] = useState<{ email: string; password: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.set('email', email)
      fd.set('name', name)
      fd.set('role', role)
      fd.set('password', password)
      try {
        await addMember(fd)
        setCreated({ email, password: password.trim() || null })
        setEmail('')
        setName('')
        setRole('MEMBER')
        setPassword('')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not add that member.')
      }
    })
  }

  const chosen = roles.find((r) => r.role === role)

  return (
    <div className="h-fit space-y-4">
      {created && (
        <div className="rounded-xl border border-ok-700/25 bg-ok-100 p-3.5">
          <div className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 size-4 flex-none text-ok-700" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-ok-700">{created.email} can sign in</p>
              {created.password ? (
                <>
                  <p className="mt-0.5 text-[12px] text-ok-700/85">
                    Copy the password now and hand it over yourself. It cannot be read
                    back later — but a new one is two clicks away.
                  </p>
                  <p className="mt-2 select-all rounded border border-ok-700/25 bg-surface px-2 py-1.5 font-mono text-[14px] font-semibold tracking-tight text-ink">
                    {created.password}
                  </p>
                </>
              ) : (
                <p className="mt-0.5 text-[12px] text-ok-700/85">
                  No password set, so they sign in with Google. The address has to match
                  their Google account exactly.
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setCreated(null)}
              aria-label="Dismiss"
              className="grid size-6 flex-none place-items-center rounded text-ok-700 transition-colors hover:bg-surface"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        </div>
      )}

      <form
        onSubmit={submit}
        className="space-y-3 rounded-xl border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(18,40,74,0.05)]"
      >
        <h2 className="flex items-center gap-2 text-[15px] font-bold text-navy-900">
          <UserPlus className="size-4 text-navy-500" aria-hidden />
          Add a member
        </h2>

        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-[0.07em] text-subtle">
            Email
          </span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            className={`mt-1 ${INPUT}`}
          />
        </label>

        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-[0.07em] text-subtle">
            Full name
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Optional"
            className={`mt-1 ${INPUT}`}
          />
        </label>

        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-[0.07em] text-subtle">
            Role
          </span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className={`mt-1 ${INPUT}`}
          >
            {roles.map((r) => (
              <option key={r.role} value={r.role}>
                {r.role.toLowerCase()}
              </option>
            ))}
          </select>
          {/* The help text under the field rather than inside the option: an option
              long enough to explain itself is an option too wide to read. */}
          {chosen && <span className="mt-1 block text-[12px] text-muted">{chosen.help}</span>}
        </label>

        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.07em] text-subtle">
            Password
          </span>
          <div className="mt-1">
            <PasswordField
              value={password}
              onChange={setPassword}
              placeholder="Leave blank for Google only"
            />
          </div>
        </div>

        <button type="submit" disabled={pending} className={`w-full ${BTN.primary}`}>
          {pending ? 'Adding…' : 'Add member'}
        </button>

        {error && <p className="text-[12px] font-semibold text-danger-700">{error}</p>}
      </form>
    </div>
  )
}
