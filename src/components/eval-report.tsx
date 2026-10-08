import Link from 'next/link'
import type { EvalReport } from '@/server/eval'

/**
 * What a run means, in the order the numbers deserve attention.
 *
 * There is no overall accuracy figure anywhere on this page, on purpose. Around seven in
 * ten of these documents were archived, so a reader that archived everything unread
 * scores about 72% — an "accuracy" line would go *up* as the reader got worse at the
 * only thing that matters. The headline is instead a count: actions a person took that
 * the pipeline would have filed away. Each one is a notice nobody would have seen.
 *
 * The entity figures are counts for the same reason: with 27 OP documents and 16 MMT,
 * one document is six percentage points, and a percentage there would read as precision
 * it does not have.
 */

function pct(n: number, of: number) {
  return of === 0 ? '—' : `${Math.round((n / of) * 100)}%`
}

function Section({
  n,
  title,
  hint,
  children,
}: {
  n: number
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <h3 className="flex items-baseline gap-2 text-[14px] font-bold text-navy-900">
        <span className="text-subtle">{n}.</span>
        {title}
      </h3>
      {hint && <p className="mt-0.5 text-[12.5px] text-muted">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

export function EvalReportView({ report }: { report: EvalReport }) {
  const d = report.decision

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-line bg-surface p-4">
        <h2 className="text-[15px] font-bold text-navy-900">{report.run.label}</h2>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-4">
          <div>
            <dt className="text-subtle">Scored</dt>
            <dd className="font-semibold text-navy-900">
              {report.scored} of {report.run.documentCount}
            </dd>
          </div>
          <div>
            <dt className="text-subtle">Model</dt>
            <dd className="font-mono text-[12px] text-navy-900">{report.run.model}</dd>
          </div>
          <div>
            <dt className="text-subtle">Tokens</dt>
            <dd className="text-navy-900">
              {report.run.inputTokens.toLocaleString('en-US')} in /{' '}
              {report.run.outputTokens.toLocaleString('en-US')} out
            </dd>
          </div>
          <div>
            <dt className="text-subtle">Finished</dt>
            <dd className="text-navy-900">
              {report.run.finishedAt
                ? report.run.finishedAt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
                : 'stopped part way'}
            </dd>
          </div>
        </dl>
        {report.run.note && <p className="mt-2 text-[12.5px] text-muted">{report.run.note}</p>}
      </div>

      <Section
        n={1}
        title="Action recall — the figure with teeth"
        hint="Every miss here is a document a person acted on that would have been filed away instead."
      >
        <div className="flex flex-wrap gap-6">
          <div>
            <p className="text-[12px] uppercase tracking-wide text-subtle">Caught</p>
            <p className="text-[22px] font-bold text-navy-900">
              {d.actionCaught}
              <span className="text-[14px] font-medium text-muted"> / {d.actionTruth}</span>
            </p>
            <p className="text-[12px] text-muted">recall {pct(d.actionCaught, d.actionTruth)}</p>
          </div>
          <div>
            <p className="text-[12px] uppercase tracking-wide text-subtle">Missed</p>
            <p
              className={`text-[22px] font-bold ${d.actionMissed > 0 ? 'text-danger-700' : 'text-navy-900'}`}
            >
              {d.actionMissed}
            </p>
            <p className="text-[12px] text-muted">notices nobody would have seen</p>
          </div>
          <div>
            <p className="text-[12px] uppercase tracking-wide text-subtle">Raised</p>
            <p className="text-[22px] font-bold text-navy-900">
              {d.archiveRaised}
              <span className="text-[14px] font-medium text-muted"> / {d.archiveTruth}</span>
            </p>
            <p className="text-[12px] text-muted">the cheap error — 30 seconds in Review</p>
          </div>
        </div>
        <p className="mt-3 border-t border-line-soft pt-2.5 text-[12.5px] text-muted">
          For scale: archiving everything unread would have scored{' '}
          <span className="font-semibold text-navy-900">{pct(d.archiveTruth, report.scored)}</span>{' '}
          on this set. That is why there is no overall accuracy figure on this page.
        </p>
      </Section>

      {d.misses.length > 0 && (
        <Section
          n={2}
          title={`The ${d.misses.length} it would have archived`}
          hint="Named, because the list is what teaches — a percentage is not reviewable."
        >
          <ul className="divide-y divide-line-soft">
            {d.misses.map((m) => (
              <li key={m.documentId} className="py-2">
                <Link
                  href={`/classify/${m.documentId}`}
                  className="text-[13px] font-semibold text-navy-900 hover:underline"
                >
                  {m.filename}
                </Link>
                <p className="mt-0.5 text-[12px] text-muted">
                  person said ACTION / {m.truthActionKind ?? '—'} · model said ARCHIVE /{' '}
                  {m.modelReason ?? '—'} · decision confidence{' '}
                  {m.decisionConfidence === null ? '—' : m.decisionConfidence.toFixed(2)}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section
        n={3}
        title="Advances to payment, or not"
        hint="Read the sample size before the numbers — this question has very few examples in the history."
      >
        <div className="flex flex-wrap gap-6 text-[13px]">
          <Stat label="Person said pay" value={report.payment.truthPay} />
          <Stat label="Model said pay" value={report.payment.modelPay} />
          <Stat label="Agreed" value={report.payment.agreed} />
          <Stat
            label="Missed a payment"
            value={report.payment.truthPay - report.payment.agreed}
            danger
          />
        </div>
        {report.payment.truthPay < 20 && (
          <p className="mt-3 rounded-lg bg-gold-50 px-3 py-2 text-[12.5px] text-navy-900">
            <span className="font-semibold">
              {report.payment.truthPay} example{report.payment.truthPay === 1 ? '' : 's'} is not a
              measurement.
            </span>{' '}
            The old spreadsheet had no &ldquo;paid&rdquo; action — these exist only because a bill
            happened to be filed — so this question cannot be answered from the history. It has to be measured
            going forward, from the approval workflow.
          </p>
        )}
      </Section>

      <Section
        n={4}
        title="Entity confusion, in documents"
        hint={`Rows are what a person recorded, columns what the model read. ${report.entity.scored} documents carry an entity.`}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-subtle">
                <th className="py-1.5 pr-3 text-left font-semibold">truth</th>
                {report.entity.columns.map((c) => (
                  <th key={c} className="px-2 py-1.5 text-right font-mono font-semibold">
                    {c}
                  </th>
                ))}
                <th className="pl-3 py-1.5 text-right font-semibold">right</th>
              </tr>
            </thead>
            <tbody>
              {report.entity.rows.map((row) => (
                <tr key={row.code} className="border-b border-line-soft">
                  <td className="py-1.5 pr-3 font-mono font-bold text-navy-900">{row.code}</td>
                  {report.entity.columns.map((c) => {
                    const n = row.cells[c] ?? 0
                    const onDiagonal = c === row.code
                    return (
                      <td
                        key={c}
                        className={`px-2 py-1.5 text-right tabular-nums ${
                          n === 0
                            ? 'text-subtle'
                            : onDiagonal
                              ? 'font-bold text-navy-900'
                              : 'font-bold text-danger-700'
                        }`}
                      >
                        {n === 0 ? '·' : n}
                      </td>
                    )
                  })}
                  <td className="pl-3 py-1.5 text-right tabular-nums text-muted">
                    {row.right}/{row.total}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[12.5px] text-muted">
          The cells to read are CP↔OP and MM↔MMT. With 27 OP documents and 16 MMT in the whole
          history, one document is six percentage points — treat anything under about four as
          noise, and fix it with account numbers rather than with prompt wording.
        </p>
      </Section>

      <Section
        n={5}
        title="By document type"
        hint="A type earns its auto-archive switch by having enough documents to mean something and zero missed actions."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[380px] text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-subtle">
                <th className="py-1.5 pr-3 text-left font-semibold">type</th>
                <th className="px-2 py-1.5 text-right font-semibold">n</th>
                <th className="px-2 py-1.5 text-right font-semibold">decision right</th>
                <th className="pl-2 py-1.5 text-right font-semibold">missed action</th>
              </tr>
            </thead>
            <tbody>
              {report.byType.map((t) => (
                <tr key={t.code} className="border-b border-line-soft">
                  <td className="py-1.5 pr-3 font-mono font-semibold text-navy-900">{t.code}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted">{t.n}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-navy-900">
                    {t.decisionRight}/{t.n}
                  </td>
                  <td
                    className={`pl-2 py-1.5 text-right tabular-nums font-bold ${
                      t.missedAction > 0 ? 'text-danger-700' : 'text-subtle'
                    }`}
                  >
                    {t.missedAction === 0 ? '·' : t.missedAction}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        n={6}
        title={`Divergences to read (${report.divergences.length})`}
        hint="Both answers, neither judged. The spreadsheet this history came from has its own mistakes — the import found several."
      >
        {report.divergences.length === 0 ? (
          <p className="text-[13px] text-muted">None.</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {report.divergences.map((v) => (
              <li key={v.documentId} className="py-2">
                <Link
                  href={`/classify/${v.documentId}`}
                  className="text-[13px] font-semibold text-navy-900 hover:underline"
                >
                  {v.filename}
                </Link>
                <p className="mt-0.5 flex flex-wrap gap-x-4 text-[12px]">
                  {v.decision && (
                    <span className="text-muted">
                      decision <span className="font-semibold text-navy-900">{v.decision.truth}</span>{' '}
                      → <span className="font-semibold text-clay-700">{v.decision.model}</span>
                    </span>
                  )}
                  {v.entity && (
                    <span className="text-muted">
                      entity <span className="font-semibold text-navy-900">{v.entity.truth}</span> →{' '}
                      <span className="font-semibold text-clay-700">{v.entity.model}</span>
                    </span>
                  )}
                </p>
                {v.addresseeAsPrinted && (
                  <p className="mt-0.5 text-[12px] text-subtle">
                    addressee as printed: {v.addresseeAsPrinted}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {report.unreadable.length > 0 && (
        <Section n={7} title={`Could not be read (${report.unreadable.length})`}>
          <ul className="space-y-1 text-[12.5px]">
            {report.unreadable.map((u) => (
              <li key={u.filename}>
                <span className="font-semibold text-navy-900">{u.filename}</span>{' '}
                <span className="text-danger-700">— {u.error}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div>
      <p className="text-[12px] uppercase tracking-wide text-subtle">{label}</p>
      <p
        className={`text-[20px] font-bold ${danger && value > 0 ? 'text-danger-700' : 'text-navy-900'}`}
      >
        {value}
      </p>
    </div>
  )
}
