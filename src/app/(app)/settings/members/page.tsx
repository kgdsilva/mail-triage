import { CircleSlash, Info, RotateCcw } from 'lucide-react'
import { setMemberActive } from '@/server/actions/settings'
import { prisma } from '@/server/db/client'
import { requireAdmin } from '@/server/session'
import { AddMemberForm } from '@/components/add-member-form'
import { MemberPassword } from '@/components/member-password'
import { BTN } from '@/lib/theme'

export const dynamic = 'force-dynamic'

/**
 * Access roles only. Who pays or confirms a given document is decided per document on
 * the classify screen, not here — the same person may confirm one item and pay the next.
 */
const ROLES = [
  { role: 'OWNER', help: 'Everything, including members and ownership' },
  { role: 'ADMIN', help: 'Everything except ownership transfer' },
  { role: 'OPERATOR', help: 'Uploads and classifies; sees the whole log' },
  { role: 'MEMBER', help: 'Works the documents routed to them' },
  { role: 'VIEWER', help: 'Read-only across the whole log' },
] as const

const ROLE_HELP: Record<string, string> = Object.fromEntries(
  ROLES.map((r) => [r.role, r.help]),
)

/** Colour by how much the role can do, so the list reads by weight before by word. */
const ROLE_TONE: Record<string, string> = {
  OWNER: 'bg-gold-100 text-gold-800',
  ADMIN: 'bg-plum-100 text-plum-700',
  OPERATOR: 'bg-navy-100 text-navy-900',
  MEMBER: 'bg-sky-100 text-sky-700',
  VIEWER: 'bg-line-soft text-muted',
}

export default async function MembersPage() {
  const session = await requireAdmin()

  const members = await prisma.membership.findMany({
    where: { companyGroupId: session.companyGroupId },
    orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    include: {
      user: {
        select: { id: true, name: true, email: true, lastLoginAt: true, passwordHash: true },
      },
    },
  })

  const active = members.filter((m) => m.isActive)

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-3">
        <div className="flex items-start gap-2.5 rounded-xl border border-navy-100 bg-navy-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-navy-900">
          <Info className="mt-0.5 size-4 flex-none text-navy-500" aria-hidden />
          <p>
            <strong className="font-bold">This list is the allowlist.</strong> Signing in
            proves who someone is; being on this list is what grants access. There is no
            invitation email and no self-signup — add the address, then either set a
            password to hand them or leave it blank so they sign in with Google.
          </p>
        </div>

        <p className="text-[12.5px] font-semibold text-muted">
          {active.length} {active.length === 1 ? 'person' : 'people'} with access
          {members.length > active.length && `, ${members.length - active.length} revoked`}
        </p>

        <div className="space-y-2.5">
          {members.map((m) => {
            const label = m.user.name ?? m.user.email
            const initials = label
              .split(/[\s@.]+/)
              .slice(0, 2)
              .map((part) => part[0])
              .join('')
              .toUpperCase()

            return (
              <div
                key={m.id}
                className={`rounded-xl border bg-surface p-4 shadow-[0_1px_2px_rgba(18,40,74,0.05)] ${
                  m.isActive ? 'border-line' : 'border-dashed border-line opacity-70'
                }`}
              >
                <div className="flex flex-wrap items-start gap-3">
                  <span
                    className={`grid size-10 flex-none place-items-center rounded-full text-[12px] font-extrabold ${
                      m.isActive ? 'bg-navy-700 text-white' : 'bg-line-soft text-muted'
                    }`}
                    aria-hidden
                  >
                    {initials}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-bold text-navy-900">
                        {m.user.name ?? m.user.email}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${ROLE_TONE[m.role] ?? 'bg-line-soft text-muted'}`}
                      >
                        {m.role.toLowerCase()}
                      </span>
                      {!m.isActive && (
                        <span className="rounded-full bg-danger-100 px-2 py-0.5 text-[11px] font-bold text-danger-700">
                          revoked
                        </span>
                      )}
                    </div>
                    {m.user.name && (
                      <p className="mt-0.5 text-[12.5px] text-muted">{m.user.email}</p>
                    )}
                    <p className="mt-0.5 text-[12px] text-subtle">
                      {ROLE_HELP[m.role]} ·{' '}
                      {m.user.lastLoginAt
                        ? `last signed in ${m.user.lastLoginAt.toLocaleDateString('en-US')}`
                        : 'never signed in'}
                    </p>
                  </div>

                  <form
                    action={setMemberActive.bind(null, m.id, !m.isActive)}
                    className="flex-none"
                  >
                    <button className={BTN.quiet}>
                      {m.isActive ? (
                        <>
                          <CircleSlash className="size-3.5" aria-hidden />
                          Revoke
                        </>
                      ) : (
                        <>
                          <RotateCcw className="size-3.5" aria-hidden />
                          Restore
                        </>
                      )}
                    </button>
                  </form>
                </div>

                <div className="mt-3 border-t border-line-soft pt-3">
                  <MemberPassword
                    membershipId={m.id}
                    email={m.user.email}
                    hasPassword={Boolean(m.user.passwordHash)}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <AddMemberForm roles={ROLES.map((r) => ({ role: r.role, help: r.help }))} />
    </div>
  )
}
