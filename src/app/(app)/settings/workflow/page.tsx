import { ArrowLeftRight, Gauge } from 'lucide-react'
import { setAutopayCeiling, setReturnedBillsRole } from '@/server/actions/settings'
import { autopayCeiling } from '@/server/action-filter'
import { emailMode } from '@/server/email'
import { NotifyPanel } from '@/components/notify-panel'
import { prisma } from '@/server/db/client'
import { DEFAULT_RETURN_ROLE, configuredReturnRole, type ReturnRole } from '@/server/returns'
import { requireAdmin } from '@/server/session'
import { BTN } from '@/lib/theme'

export const dynamic = 'force-dynamic'

/**
 * How work moves between people. One setting so far, and it earned its own screen.
 */

/*
 * Listed in the order they are tried, so the list doubles as the fallback chain: the
 * first one with somebody in it gets the bill.
 */
const CHOICES: { role: ReturnRole; label: string; help: string }[] = [
  {
    role: 'OWNER',
    label: 'Owner',
    help: 'The person who actually reads the post. The default here.',
  },
  {
    role: 'ADMIN',
    label: 'Admin',
    help: 'If running the mail day to day is somebody else’s job.',
  },
  {
    role: 'OPERATOR',
    label: 'Operator',
    help: 'If uploading and classifying belongs to a third person again.',
  },
]

export default async function WorkflowPage() {
  const session = await requireAdmin()

  const group = await prisma.companyGroup.findUniqueOrThrow({
    where: { id: session.companyGroupId },
    select: { settings: true },
  })
  const current = configuredReturnRole(group.settings)
  const ceiling = await autopayCeiling(session.companyGroupId)

  // Who currently holds each role, so the choice shows its consequence rather than
  // making somebody go and look it up on another screen.
  const members = await prisma.membership.findMany({
    where: {
      companyGroupId: session.companyGroupId,
      isActive: true,
      role: { in: CHOICES.map((c) => c.role) },
    },
    orderBy: { createdAt: 'asc' },
    select: { role: true, user: { select: { name: true, email: true } } },
  })

  const holders = (role: string) =>
    members.filter((m) => m.role === role).map((m) => m.user.name ?? m.user.email)

  return (
    <div className="max-w-2xl space-y-4">
      <div className="rounded-xl border border-line bg-surface p-5">
        <h2 className="flex items-center gap-2 text-[15px] font-bold text-navy-900">
          <ArrowLeftRight className="size-4 text-navy-500" aria-hidden />
          Returned bills go to
        </h2>
        <p className="mt-1 text-[13px] text-muted">
          When an approver denies a bill or sends it back with a question, it returns as
          an action on <span className="font-semibold">Needs a decision</span>, with their
          note. This is whose name it arrives in.
        </p>

        <div className="mt-4 space-y-2">
          {CHOICES.map((choice) => {
            const who = holders(choice.role)
            const on = current === choice.role
            return (
              <form key={choice.role} action={setReturnedBillsRole.bind(null, choice.role)}>
                <button
                  className={`flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors ${
                    on
                      ? 'border-navy-500 bg-navy-50'
                      : 'border-line bg-surface hover:border-navy-500 hover:bg-navy-50'
                  }`}
                >
                  <span
                    className={`mt-0.5 grid size-4 flex-none place-items-center rounded-full border-2 ${
                      on ? 'border-navy-700' : 'border-line'
                    }`}
                    aria-hidden
                  >
                    {on && <span className="size-2 rounded-full bg-navy-700" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-bold text-navy-900">{choice.label}</span>
                      {on && (
                        <span className="rounded-full bg-navy-700 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-white">
                          current
                        </span>
                      )}
                      {/* Says which one applies when nobody has chosen, so an untouched
                          setting is not a mystery. */}
                      {choice.role === DEFAULT_RETURN_ROLE && (
                        <span className="rounded-full bg-line-soft px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted">
                          default
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[12.5px] text-muted">{choice.help}</span>
                    {/*
                      Nobody holding the role is the case that matters: the setting would
                      be configured and still send bills nowhere, so it says so here
                      rather than at the moment a bill is refused.
                    */}
                    <span className="mt-1 block text-[12px]">
                      {who.length > 0 ? (
                        <span className="text-subtle">Today: {who.join(', ')}</span>
                      ) : (
                        <span className="font-semibold text-gold-800">
                          Nobody holds this role — bills would fall through to the next one
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </form>
            )
          })}
        </div>

        <p className="mt-4 border-t border-line-soft pt-3 text-[12px] text-subtle">
          A role, not a person, so this keeps working when somebody is away or the job
          changes hands. Within the role it goes to the longest-standing member, and if
          nobody at all holds any of these the bill comes back unassigned — still visible,
          under “Nobody yet”.
        </p>
      </div>

      {/* Nothing on this screen matters if nobody is told it happened. */}
      <NotifyPanel {...emailMode()} />

      {/*
        The second question this screen answers: not who gets a bill back, but which
        bills need anybody at all.
      */}
      <div className="rounded-xl border border-line bg-surface p-5">
        <h2 className="flex items-center gap-2 text-[15px] font-bold text-navy-900">
          <Gauge className="size-4 text-navy-500" aria-hidden />
          Autopay still needs approval above
        </h2>
        <p className="mt-1 text-[13px] text-muted">
          A bill from a vendor on confirmed autopay is logged and filed without reaching an
          approver — that is the point of the autopay list. Above this amount it goes for
          approval anyway. The payment itself is automatic either way; this only decides
          whether somebody sees it first.
        </p>

        <form action={setAutopayCeiling} className="mt-4 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="block text-[12px] font-semibold text-navy-900">Ceiling (USD)</span>
            <input
              name="ceiling"
              defaultValue={ceiling === null ? '' : String(ceiling)}
              placeholder="1000"
              inputMode="decimal"
              className="mt-1 w-40 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-navy-500"
            />
          </label>
          <button className={BTN.primary}>Save</button>
        </form>

        <p className="mt-2 text-[12px] text-subtle">
          {ceiling === null
            ? 'Off — autopay settles any amount without an approver.'
            : `Now: anything over ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(ceiling)} goes for approval even on autopay.`}{' '}
          Leave it empty to turn the ceiling off. A single arrangement can be given its own
          ceiling on its autopay rule, which wins over this one.
        </p>

        <p className="mt-3 border-t border-line-soft pt-3 text-[12px] text-subtle">
          Partial autopay is never affected: an arrangement that settles only part of a
          balance always reaches a person, whatever the amount.
        </p>
      </div>

      <p className="text-[12.5px] text-muted">
        Changing this affects bills refused from now on. Anything already returned stays
        where it was sent, and its history says who sent it and when.
      </p>
    </div>
  )
}
