import Link from 'next/link'
import { AlertTriangle, Check } from 'lucide-react'
import { healthReport } from '@/server/health'
import { requireAdmin } from '@/server/session'

export const dynamic = 'force-dynamic'

/**
 * What is wrong right now, without anybody having to ask.
 *
 * Every check here is something that already went wrong in this office and was found
 * because a person noticed and complained — an approver turned away from adding a bill
 * because his company had nobody to approve it, a question handed over with no question
 * in it, cheques filed under a spend category and quietly doubling the totals. The
 * pattern was always the same: the system knew, and had no way to say so.
 *
 * Zero is shown, not hidden. A screen that lists only problems cannot tell you the
 * difference between "nothing is wrong" and "the check stopped running", and the second
 * is how a monitor becomes decoration. Everything green is itself the answer to "is
 * anything broken", which is the question that brings somebody here.
 */
export default async function HealthPage() {
  const session = await requireAdmin()
  const findings = await healthReport(session.companyGroupId)

  const problems = findings.filter((f) => f.count > 0)
  const clear = findings.filter((f) => f.count === 0)

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-4">
        <h1 className="text-[26px] font-bold tracking-tight text-navy-900">Health</h1>
        <p className="mt-1 text-sm text-muted">
          Things that are wrong and that nothing else would have told you about. Checked
          every time you open this page.
        </p>
      </header>

      <p
        className={`mb-4 rounded-xl px-4 py-3 text-[14px] font-semibold ${
          problems.length === 0
            ? 'bg-ok-100 text-ok-700'
            : 'bg-gold-100 text-gold-800'
        }`}
      >
        {problems.length === 0
          ? `All ${findings.length} checks are clear.`
          : `${problems.length} of ${findings.length} checks found something.`}
      </p>

      {problems.length > 0 && (
        <ul className="mb-6 space-y-2">
          {problems.map((f) => (
            <li key={f.key} className="rounded-xl border border-gold-500 bg-surface p-4">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="mt-0.5 size-4 flex-none text-gold-800" aria-hidden />
                <div className="min-w-0 flex-1">
                  <h2 className="text-[15px] font-bold text-navy-900">
                    {f.title}
                    <span className="tabular ml-2 rounded-full bg-gold-100 px-2 py-0.5 text-[12px] font-bold text-gold-800">
                      {f.count}
                    </span>
                  </h2>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink">{f.because}</p>

                  {f.examples.length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {f.examples.map((name) => (
                        <li key={name} className="truncate font-mono text-[12px] text-muted">
                          {name}
                        </li>
                      ))}
                      {f.count > f.examples.length && (
                        <li className="text-[12px] text-subtle">
                          and {f.count - f.examples.length} more
                        </li>
                      )}
                    </ul>
                  )}

                  <p className="mt-2 text-[12.5px] font-semibold text-navy-700">
                    {f.fix}{' '}
                    {f.href && (
                      <Link href={f.href} className="underline">
                        Go there
                      </Link>
                    )}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {clear.length > 0 && (
        <>
          <h2 className="mb-2 text-[13px] font-bold uppercase tracking-[0.09em] text-subtle">
            Clear · {clear.length}
          </h2>
          <ul className="space-y-1">
            {clear.map((f) => (
              <li
                key={f.key}
                className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2"
              >
                <Check className="size-3.5 flex-none text-ok-700" aria-hidden />
                <span className="text-[13px] text-muted">{f.title}</span>
                <span className="ml-auto text-[12px] font-bold text-ok-700">none</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
