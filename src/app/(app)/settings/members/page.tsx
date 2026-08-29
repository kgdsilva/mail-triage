import { addMember, setMemberActive, setMemberPassword } from '@/server/actions/settings'
import { prisma } from '@/server/db/client'
import { requireAdmin } from '@/server/session'

export const dynamic = 'force-dynamic'

/**
 * Access roles only. Who pays or confirms a given document is decided per document on
 * the classify screen, not here — the same person may confirm one item and pay the next.
 */
const ROLE_HELP: Record<string, string> = {
  OWNER: 'Everything, including members and ownership',
  ADMIN: 'Everything except ownership transfer',
  OPERATOR: 'Uploads and classifies; sees the whole log',
  MEMBER: 'Works the documents routed to them',
  VIEWER: 'Read-only across the whole log',
}

export default async function MembersPage() {
  const session = await requireAdmin()

  const members = await prisma.membership.findMany({
    where: { companyGroupId: session.companyGroupId },
    orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    include: { user: { select: { id: true, name: true, email: true, lastLoginAt: true, passwordHash: true } } },
  })

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-2">
        <div className="rounded-lg border border-line bg-navy-50 px-3 py-2 text-xs text-muted">
          This list is the allowlist. Signing in proves who someone is; being on this list
          is what grants access. There is no invitation email and no self-signup — add the
          address, and either set a password to hand them, or leave it blank so they sign
          in with Google.
        </div>

        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-[10.5px] uppercase tracking-[0.07em] text-subtle">
              <tr>
                <th className="px-4 py-3 font-semibold">Person</th>
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="px-4 py-3 font-semibold">Signs in with</th>
                <th className="px-4 py-3 font-semibold">Last signed in</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {members.map((m) => (
                <tr key={m.id} className={m.isActive ? '' : 'text-subtle'}>
                  <td className="px-3 py-2 align-top">
                    <span className="block">{m.user.name ?? '—'}</span>
                    <span className="block text-xs text-muted">{m.user.email}</span>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span className="text-xs">{m.role.toLowerCase()}</span>
                    <span className="block text-[11px] text-muted">{ROLE_HELP[m.role]}</span>
                  </td>
                  <td className="px-3 py-2 align-top text-xs">
                    {m.user.passwordHash ? 'Password or Google' : 'Google only'}
                    <form
                      action={setMemberPassword.bind(null, m.id)}
                      className="mt-1 flex items-center gap-1"
                    >
                      <input
                        name="password"
                        type="password"
                        placeholder={m.user.passwordHash ? 'New password' : 'Set password'}
                        autoComplete="new-password"
                        className="w-32 rounded-lg border border-line bg-transparent px-1.5 py-1 text-[11px] outline-none focus:border-navy-500"
                      />
                      <button className="text-[11px] text-muted underline hover:text-ink">
                        Save
                      </button>
                    </form>
                    {m.user.passwordHash && (
                      <span className="mt-0.5 block text-[10px] text-subtle">
                        Save blank to remove the password
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-xs">
                    {m.user.lastLoginAt ? (
                      m.user.lastLoginAt.toLocaleDateString('en-US')
                    ) : (
                      <span className="text-subtle">never</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right align-top">
                    <form action={setMemberActive.bind(null, m.id, !m.isActive)}>
                      <button className="text-xs text-muted underline hover:text-ink">
                        {m.isActive ? 'Revoke' : 'Restore'}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <form
        action={addMember}
        className="h-fit space-y-3 rounded-lg border border-line bg-surface p-4"
      >
        <p className="text-sm font-medium">Add a member</p>
        <input name="email" type="email" required placeholder="name@example.com" className={inputClass} />
        <input name="name" placeholder="Full name (optional)" className={inputClass} />
        <select name="role" defaultValue="MEMBER" className={inputClass}>
          {Object.entries(ROLE_HELP).map(([role, help]) => (
            <option key={role} value={role}>
              {role.toLowerCase()} — {help}
            </option>
          ))}
        </select>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="Password (blank = Google only)"
          className={inputClass}
        />
        <button className="w-full rounded-lg bg-navy-700 px-3 py-2 text-sm text-white">
          Add member
        </button>
        <p className="text-[11px] text-muted">
          If you set a password, hand it to them directly — there is no reset email. To
          use Google instead, leave it blank; the address must match their Google account.
        </p>
      </form>
    </div>
  )
}

const inputClass =
  'w-full rounded-lg border border-line bg-transparent px-2 py-1.5 text-sm outline-none focus:border-navy-500'
