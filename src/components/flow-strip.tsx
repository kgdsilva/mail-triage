import Link from 'next/link'

/**
 * The whole path, on every screen that is a part of it.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 *
 * The app had three queues — Needs a decision, Bills to approve, Accounting — named
 * after places rather than after the questions they answer, and nothing anywhere drew
 * the line connecting them. Each screen was a bucket that knew only its own contents.
 *
 * What that costs is not elegance. It is that when something is not in the bucket you
 * opened, the only conclusion available is that it was lost: you cannot tell a thing
 * that has moved on from a thing that never arrived, because you have no picture of
 * what "moved on" would even mean. An afternoon went to hunting a bill that was sitting
 * exactly where the process puts it, and the people hunting it included the person who
 * wrote the process.
 *
 * So: five steps, in order, on each screen that is one of them, with the current one
 * lit. Not a navigation bar — the navigation already exists and is not the problem.
 * This answers "what happens here, what happened before, and what happens next", which
 * is a question no amount of better menu labels was ever going to reach.
 *
 * Each step says who does it, because "it is with accounting" is only useful to someone
 * who knows that accounting is Chris.
 */

export type FlowStep = 'arrives' | 'decide' | 'approve' | 'pay' | 'paid'

const STEPS: { key: FlowStep; label: string; who: string; href: string }[] = [
  { key: 'arrives', label: 'Arrives', who: 'scanned or emailed', href: '/upload' },
  { key: 'decide', label: 'Is it a bill?', who: 'the office decides', href: '/' },
  { key: 'approve', label: 'Approval', who: 'the approver clears it', href: '/approvals' },
  { key: 'pay', label: 'Payment', who: 'the accountant pays', href: '/accounting' },
  { key: 'paid', label: 'Paid', who: 'filed, nothing owed', href: '/paid' },
]

export function FlowStrip({
  current,
  /**
   * Steps this person cannot open. Shown anyway, as plain text rather than a link: the
   * point is that they can see where their own work sits in a line that continues
   * without them. Hiding the rest is how an approver comes to believe approving is the
   * end of it.
   */
  unreachable = [],
}: {
  current: FlowStep
  unreachable?: FlowStep[]
}) {
  return (
    <nav aria-label="Where this screen sits in the process" className="mb-4 overflow-x-auto">
      <ol className="flex min-w-fit items-stretch gap-1">
        {STEPS.map((step, i) => {
          const here = step.key === current
          const blocked = unreachable.includes(step.key)
          const body = (
            <>
              <span className="block text-[12px] font-bold leading-tight">{step.label}</span>
              <span
                className={`block text-[11px] leading-tight ${here ? 'text-navy-100' : 'text-subtle'}`}
              >
                {step.who}
              </span>
            </>
          )

          return (
            <li key={step.key} className="flex items-stretch">
              {i > 0 && (
                <span
                  aria-hidden
                  className="self-center px-1 text-[13px] font-bold text-line"
                >
                  ›
                </span>
              )}
              {here ? (
                <span
                  aria-current="step"
                  className="rounded-lg bg-navy-900 px-3 py-1.5 text-white"
                >
                  {body}
                </span>
              ) : blocked ? (
                <span className="rounded-lg px-3 py-1.5 text-muted opacity-60">{body}</span>
              ) : (
                <Link
                  href={step.href}
                  className="rounded-lg px-3 py-1.5 text-muted hover:bg-navy-50 hover:text-navy-900"
                >
                  {body}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
