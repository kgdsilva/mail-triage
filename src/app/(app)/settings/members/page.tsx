import { addMember, setMemberActive } from '@/server/actions/settings'
import { prisma } from '@/server/db/client'
import { requireAdmin } from '@/server/session'

export const dynamic = 'force-dynamic'

const ROLE_HELP: Record<string, string> = {
  OWNER: 'Everything, including members and configuration',
  ADMIN: 'Everything except ownership transfer',
  OPERATOR: 'Uploads batches and classifies documents',
  PAYER: 'Sees only bills routed to them to pay',
  CONFIRMER: 'Sees only items needing verification before money moves',
  VIEWER: 'Read-only access to the master log',
}

export default async function MembersPage() {
  const session = await requireAdmin()

  const members = await prisma.membership.findMany({
    where: { companyGroupId: session.companyGroupId },
    orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    include: { user: true },
  })

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-2">
        <div className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
          This list is the allowlist. Signing in with Google proves who someone is; being
          on this list is what grants access. There is no invitation email — add the
          address and the person signs in with Google.
        </div>

        <div className="overflow-hidden rounded border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500 dark:border-neutral-800">
              <tr>
                <th className="px-3 py-2 font-medium">Person</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Last signed in</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {members.map((m) => (
                <tr key={m.id} className={m.isActive ? '' : 'text-neutral-400'}>
                  <td className="px-3 py-2">
                    <span className="block">{m.user.name ?? '—'}</span>
                    <span className="block text-xs text-neutral-500">{m.user.email}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-xs">{m.role.toLowerCase()}</span>
                    <span className="block text-[11px] text-neutral-500">
                      {ROLE_HELP[m.role]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {m.user.lastLoginAt
                      ? m.user.lastLoginAt.toLocaleDateString('en-US')
                      : <span className="text-neutral-400">never</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
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
        <input
          name="email"
          type="email"
          required
          placeholder="name@colabservice.com"
          className={inputClass}
        />
        <input name="name" placeholder="Full name (optional)" className={inputClass} />
        <select name="role" defaultValue="PAYER" className={inputClass}>
          {Object.entries(ROLE_HELP).map(([role, help]) => (
            <option key={role} value={role}>
              {role.toLowerCase()} — {help}
            </option>
          ))}
        </select>
        <button className="w-full rounded bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900">
          Add member
        </button>
        <p className="text-[11px] text-neutral-500">
          Must be the address on their Google account.
        </p>
      </form>
    </div>
  )
}

const inputClass =
  'w-full rounded border border-neutral-300 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-300'
