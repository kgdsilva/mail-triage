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
        <div className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
          This list is the allowlist. Signing in proves who someone is; being on this list
          is what grants access. There is no invitation email and no self-signup — add the
          address, and either set a password to hand them, or leave it blank so they sign
          in with Google.
        </div>

        <div className="overflow-hidden rounded border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500 dark:border-neutral-800">
              <tr>
                <th className="px-3 py-2 font-medium">Person</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Signs in with</th>
                <th className="px-3 py-2 font-medium">Last signed in</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {members.map((m) => (
                <tr key={m.id} className={m.isActive ? '' : 'text-neutral-400'}>
                  <td className="px-3 py-2 align-top">
                    <span className="block">{m.user.name ?? '—'}</span>
                    <span className="block text-xs text-neutral-500">{m.user.email}</span>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span className="text-xs">{m.role.toLowerCase()}</span>
                    <span className="block text-[11px] text-neutral-500">{ROLE_HELP[m.role]}</span>
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
                        className="w-32 rounded border border-neutral-300 bg-transparent px-1.5 py-1 text-[11px] outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-300"
                      />
                      <button className="text-[11px] text-neutral-500 underline hover:text-neutral-900 dark:hover:text-neutral-100">
                        Save
                      </button>
                    </form>
                    {m.user.passwordHash && (
                      <span className="mt-0.5 block text-[10px] text-neutral-400">
                        Save blank to remove the password
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-xs">
                    {m.user.lastLoginAt ? (
                      m.user.lastLoginAt.toLocaleDateString('en-US')
                    ) : (
                      <span className="text-neutral-400">never</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right align-top">
                    <form action={setMemberActive.bind(null, m.id, !m.isActive)}>
                      <button className="text-xs text-neutral-500 underline hover:text-neutral-900 dark:hover:text-neutral-100">
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
        className="h-fit space-y-3 rounded border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
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
        <button className="w-full rounded bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900">
          Add member
        </button>
        <p className="text-[11px] text-neutral-500">
          If you set a password, hand it to them directly — there is no reset email. To
          use Google instead, leave it blank; the address must match their Google account.
        </p>
      </form>
    </div>
  )
}

const inputClass =
  'w-full rounded border border-neutral-300 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-300'
