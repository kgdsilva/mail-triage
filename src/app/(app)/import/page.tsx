import Link from 'next/link'
import { requireTriage } from '@/server/session'
import { reconciliation, storedReport } from '@/server/import'
import { supportsDirectUpload } from '@/server/storage'
import { awaitingFiles } from '@/server/actions/import'
import { ImportHistory } from '@/components/import-history'
import { BackLink } from '@/components/back'
import { entityColor } from '@/lib/theme'

export const dynamic = 'force-dynamic'

export default async function ImportPage() {
  const session = await requireTriage()
  const [report, counts, waiting] = await Promise.all([
    storedReport(session.companyGroupId),
    reconciliation(session.companyGroupId),
    awaitingFiles(),
  ])

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <BackLink href="/log" label="Master log" />
        <h1 className="mt-2 text-[26px] font-bold tracking-tight text-navy-900">
          Import the history
        </h1>
        <p className="mt-1 text-sm text-muted">
          The months that were processed by hand, brought in as master-log rows and then
          matched up with their PDFs. Once both halves are here, this screen is finished
          with — everything after it arrives through Upload.
        </p>
      </div>

      <ImportHistory direct={supportsDirectUpload()} />

      {/*
        Step three is not a step you do — it is what is left over, and it has to stay on
        the screen after the tab is closed. Two numbers answer the only question that
        matters at the end of an import: is anything still unaccounted for?
      */}
      <section className="rounded-xl border border-line bg-surface p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-navy-100 text-[12px] font-extrabold text-navy-900">
            3
          </span>
          <div>
            <h2 className="text-[15px] font-bold tracking-tight text-navy-900">
              What is still unaccounted for
            </h2>
            <p className="mt-0.5 text-[13px] text-muted">
              Both numbers reach zero when every row has its file and every file has its row.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <Stat
            label="Rows waiting for a PDF"
            value={counts.awaitingFile}
            tone={counts.awaitingFile ? 'gold' : 'ok'}
          />
          <Stat
            label="Files with no row"
            value={counts.unmatchedFiles}
            tone={counts.unmatchedFiles ? 'gold' : 'ok'}
            href={counts.unmatchedFiles ? '/review' : undefined}
          />
          <Stat label="Documents with their file" value={counts.attached} />
        </div>

        {counts.unmatchedFiles > 0 && (
          <p className="mt-3 text-[12.5px] text-muted">
            Those are on{' '}
            <Link href="/review" className="font-semibold text-navy-700 underline">
              Review
            </Link>{' '}
            waiting to be identified — a PDF whose name matched nothing is still a document,
            so it asks rather than disappearing.
          </p>
        )}

        {waiting.length > 0 && (
          <details className="mt-4 rounded-lg border border-line bg-canvas px-3 py-2">
            <summary className="text-[13px] font-semibold text-navy-900">
              The rows still waiting ({waiting.length}
              {waiting.length === 500 ? '+' : ''})
            </summary>
            <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto text-[12.5px]">
              {waiting.map((d) => (
                <li key={d.id} className="flex items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10.5px] font-bold ${entityColor(
                      d.entity?.code,
                    )}`}
                  >
                    {d.entity?.code ?? '—'}
                  </span>
                  <span className="truncate font-mono">{d.finalFilename}</span>
                  {d.legacyBoxUrl && (
                    <a
                      href={d.legacyBoxUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto shrink-0 text-[11.5px] font-semibold text-navy-700 underline"
                    >
                      in Box
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}

        {report && (
          <div className="mt-4 space-y-2 border-t border-line pt-4">
            <p className="text-[12.5px] text-muted">
              Last import: {new Date(report.importedAt).toLocaleString()} — {report.imported} of{' '}
              {report.totalRows} rows.
            </p>
            {report.blocked.length > 0 && (
              <details open className="rounded-lg border border-gold-500 bg-gold-100/50 px-3 py-2">
                <summary className="text-[13px] font-bold text-navy-900">
                  {report.blocked.length} row{report.blocked.length === 1 ? '' : 's'} could not be
                  imported
                </summary>
                <p className="mt-2 text-[12.5px] text-muted">
                  Kept here rather than dropped. Fix the cause — usually a company that does not
                  exist in this workspace — and import the same file again.
                </p>
                <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-[12.5px]">
                  {report.blocked.map((b) => (
                    <li key={`${b.line}-${b.finalFilename}`}>
                      <span className="font-mono font-semibold">Line {b.line}</span> · {b.reason}
                      <span className="block truncate font-mono text-subtle">
                        {b.finalFilename || b.notes}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
  href,
}: {
  label: string
  value: number
  tone?: 'gold' | 'ok'
  href?: string
}) {
  const ring =
    tone === 'gold'
      ? 'border-gold-500 bg-gold-100'
      : tone === 'ok'
        ? 'border-ok-700/30 bg-ok-100'
        : 'border-line bg-canvas'

  const body = (
    <div className={`rounded-lg border px-3 py-2 ${ring} ${href ? 'hover:border-navy-500' : ''}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="text-[22px] font-extrabold tracking-tight text-navy-900">{value}</p>
    </div>
  )

  return href ? <Link href={href}>{body}</Link> : body
}
