import Link from 'next/link'
import { FlaskConical } from 'lucide-react'
import { prisma } from '@/server/db/client'
import { aiConfigured } from '@/server/ai/read-document'
import {
  PILOT_SIZE,
  buildReport,
  estimateCost,
  evalSet,
  listRuns,
  pilotDone,
} from '@/server/eval'
import { requireAdmin } from '@/server/session'
import { EvalRunner } from '@/components/eval-runner'
import { EvalReportView } from '@/components/eval-report'
import { KeyShape } from '@/components/key-shape'

export const dynamic = 'force-dynamic'

/**
 * Measuring the reader against mail that has already been decided.
 *
 * Admin only, and it reads rather than writes: the evaluation never touches a document,
 * which is the only way scoring the imported history means anything — the history is the
 * answer key, and the ordinary reading path would overwrite it.
 *
 * It lives on a screen rather than in a script because the files are in R2 and the
 * database is production, and neither belongs on a laptop. Here it runs where the app
 * already has both, with no credentials to copy anywhere and no override flags.
 */

function money(n: number) {
  return `$${n.toFixed(2)}`
}

export default async function EvaluationPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string }>
}) {
  const session = await requireAdmin()
  const { run: runParam } = await searchParams

  const [set, runs, unlocked] = await Promise.all([
    evalSet(session.companyGroupId),
    listRuns(session.companyGroupId),
    pilotDone(session.companyGroupId),
  ])

  // The newest run with anything in it, unless a specific one was asked for.
  const chosenId = runParam ?? runs.find((r) => r._count.results > 0)?.id
  const report = chosenId ? await buildReport(chosenId, session.companyGroupId) : null

  // A run that was stopped part way, so it can be continued rather than restarted.
  const unfinished = runs.find((r) => r.finishedAt === null && r._count.results < r.documentCount)

  const payCount = await prisma.document.count({
    where: {
      companyGroupId: session.companyGroupId,
      deletedAt: null,
      isDemo: false,
      actionKind: 'PAY',
    },
  })

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface p-5">
        <h2 className="flex items-center gap-2 text-[15px] font-bold text-navy-900">
          <FlaskConical className="size-4 text-navy-500" aria-hidden />
          Evaluation
        </h2>
        <p className="mt-1 text-[13px] text-muted">
          Runs the reader over mail somebody already decided, and scores it against those
          decisions. Nothing is written to any document — not the entity, not the decision, not
          the status. Only the evaluation tables.
        </p>

        {/*
          The set is stated rather than implied. Three different sets can all be called
          "the history" and they give three different answers, so the denominators are
          printed next to the numbers that use them.
        */}
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-line-soft pt-3 text-[12.5px] sm:grid-cols-4">
          <div>
            <dt className="text-subtle">Scorable for the decision</dt>
            <dd className="text-[17px] font-bold text-navy-900">{set.total}</dd>
            <dd className="text-[11.5px] text-subtle">a stored file and a human decision</dd>
          </div>
          <div>
            <dt className="text-subtle">Scorable for the entity</dt>
            <dd className="text-[17px] font-bold text-navy-900">{set.withEntity}</dd>
            <dd className="text-[11.5px] text-subtle">
              those that also carry an entity
            </dd>
          </div>
          <div>
            <dt className="text-subtle">Archive / action</dt>
            <dd className="text-[17px] font-bold text-navy-900">
              {set.archive} / {set.action}
            </dd>
            <dd className="text-[11.5px] text-subtle">
              archiving everything scores {Math.round(set.baseline * 100)}%
            </dd>
          </div>
          <div>
            <dt className="text-subtle">Marked as pay</dt>
            <dd
              className={`text-[17px] font-bold ${payCount < 20 ? 'text-gold-800' : 'text-navy-900'}`}
            >
              {payCount}
            </dd>
            <dd className="text-[11.5px] text-subtle">the payment question&rsquo;s whole sample</dd>
          </div>
        </dl>
      </div>

      <KeyShape always />

      {!aiConfigured() ? (
        <p className="rounded-xl border border-danger-500 bg-danger-100 px-4 py-3 text-[13px] text-danger-700">
          <span className="font-semibold">ANTHROPIC_API_KEY is not set here.</span> Nothing can be
          read until it is.
        </p>
      ) : (
        <EvalRunner
          pilotSize={Math.min(PILOT_SIZE, set.total)}
          fullSize={set.total}
          pilotEstimate={money(estimateCost(Math.min(PILOT_SIZE, set.total)))}
          fullEstimate={money(estimateCost(set.total))}
          pilotUnlocked={unlocked}
          resumable={
            unfinished
              ? {
                  id: unfinished.id,
                  label: unfinished.label,
                  done: unfinished._count.results,
                  total: unfinished.documentCount,
                }
              : null
          }
        />
      )}

      {runs.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3">
          <span className="text-[12.5px] font-semibold text-subtle">Runs</span>
          {runs.map((r) => (
            <Link
              key={r.id}
              href={`/settings/evaluation?run=${r.id}`}
              className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${
                r.id === chosenId
                  ? 'bg-navy-700 text-white'
                  : 'bg-line-soft text-muted hover:bg-navy-50 hover:text-navy-700'
              }`}
            >
              {r.label} · {r._count.results}
            </Link>
          ))}
        </div>
      )}

      {report ? (
        <EvalReportView report={report} />
      ) : (
        <p className="rounded-xl border border-line bg-surface px-4 py-3 text-[13px] text-muted">
          No run has read anything yet. Start with the pilot — ten documents, a few cents, and it
          answers the two questions worth answering before spending the rest: whether the reader
          can reach the files at all, and what a page really costs here.
        </p>
      )}
    </div>
  )
}
