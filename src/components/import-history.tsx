'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileSpreadsheet, FolderOpen } from 'lucide-react'
import {
  attachFile,
  attachFileForm,
  prepareFile,
  previewImport,
  runImport,
  type PreviewResult,
} from '@/server/actions/import'
import { BTN } from '@/lib/theme'

/**
 * The spreadsheet and the PDFs, in the order they have to happen.
 *
 * Step one never writes anything until it has been read: the preview is the whole point
 * of the screen. Three hundred and fifty rows of somebody's year of work is not
 * something to import and then find out about.
 */
export function ImportHistory({ direct }: { direct: boolean }) {
  return (
    <div className="space-y-5">
      <Spreadsheet />
      <Files direct={direct} />
    </div>
  )
}

function Card({
  step,
  title,
  blurb,
  children,
}: {
  step: number
  title: string
  blurb: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-navy-100 text-[12px] font-extrabold text-navy-900">
          {step}
        </span>
        <div>
          <h2 className="text-[15px] font-bold tracking-tight text-navy-900">{title}</h2>
          <p className="mt-0.5 text-[13px] text-muted">{blurb}</p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function Spreadsheet() {
  const router = useRouter()
  const [csv, setCsv] = useState<{ name: string; text: string } | null>(null)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [busy, setBusy] = useState<'reading' | 'importing' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function read(file: File) {
    setError(null)
    setDone(null)
    setPreview(null)
    setBusy('reading')
    try {
      const text = await file.text()
      setCsv({ name: file.name, text })
      setPreview(await previewImport(text))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file.')
    } finally {
      setBusy(null)
    }
  }

  async function commit() {
    if (!csv) return
    setBusy('importing')
    setError(null)
    try {
      const res = await runImport(csv.text)
      setDone(
        `${res.created} document${res.created === 1 ? '' : 's'} created, ${res.updated} updated, ` +
          `across ${res.batches} month${res.batches === 1 ? '' : 's'}. ` +
          `${res.foldersCreated} folder${res.foldersCreated === 1 ? '' : 's'} created.`,
      )
      setPreview(null)
      setCsv(null)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The import failed.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card
      step={1}
      title="The master spreadsheet"
      blurb="Drop the CSV in. Nothing is written until you have read what it is going to do."
    >
      <label className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed border-line px-4 py-4 transition-colors hover:border-navy-500">
        <FileSpreadsheet className="size-5 text-navy-500" strokeWidth={1.7} aria-hidden />
        <span className="text-[13px] text-muted">
          {csv ? (
            <span className="font-semibold text-navy-900">{csv.name}</span>
          ) : (
            <>
              Choose the exported <span className="font-semibold text-navy-900">.csv</span>
            </>
          )}
        </span>
        <input
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void read(file)
          }}
        />
      </label>

      {busy === 'reading' && <p className="mt-3 text-[13px] text-muted">Reading…</p>}
      {error && (
        <p className="mt-3 rounded-lg bg-danger-100 px-3 py-2 text-[13px] text-danger-700">
          {error}
        </p>
      )}
      {done && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-ok-100 px-3 py-2 text-[13px] text-emerald-900">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
          {done}
        </p>
      )}

      {preview && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-2 sm:grid-cols-4">
            <Figure label="Rows in the file" value={preview.totalRows} />
            <Figure label="New documents" value={preview.willCreate} tone="navy" />
            <Figure label="Rows already imported" value={preview.willUpdate} />
            <Figure
              label="Held for you"
              value={preview.blocked.length}
              tone={preview.blocked.length ? 'gold' : undefined}
            />
          </div>

          <p className="text-[12.5px] text-muted">
            {preview.openAfterImport} of them are still open and will appear in the queue.{' '}
            {preview.withAmount} carry an amount, {preview.withDueDate} a due date,{' '}
            {preview.assigned} a person with an account here.
          </p>

          <Detail
            title={`Months (${preview.byMonth.length})`}
            tone="plain"
            lines={preview.byMonth.map((m) => `${m.label} — ${m.rows} rows`)}
          />

          {preview.blocked.length > 0 && (
            <Detail
              title={`Held back — these cannot become documents yet (${preview.blocked.length})`}
              tone="warn"
              open
              lines={preview.blocked.map(
                (b) => `Line ${b.line}: ${b.reason} — ${b.finalFilename || '(no name)'}`,
              )}
              footer="These are not imported and not lost: they stay in the report until the cause is fixed, then re-import the same file."
            />
          )}

          {preview.dateSwaps.length > 0 && (
            <Detail
              title={`Review dates read day-first (${preview.dateSwaps.length})`}
              tone="warn"
              lines={preview.dateSwaps.map((n) => `Line ${n.line}: ${n.detail}`)}
              footer="The month as written contradicted the month folder, and swapping the day and month resolved it. Every other row was taken exactly as written."
            />
          )}

          {preview.folderRepairs.length > 0 && (
            <Detail
              title={`Folder names repaired (${preview.folderRepairs.length})`}
              tone="warn"
              lines={preview.folderRepairs.map((n) => `Line ${n.line}: ${n.detail}`)}
              footer="Names that look cut off at a column edge, matched to the folder they belong in rather than creating a near-duplicate beside it."
            />
          )}

          {preview.newFolders.length > 0 && (
            <Detail
              title={`Folders to create (${preview.newFolders.length})`}
              tone="plain"
              lines={preview.newFolders.map((f) => `${f.path} — ${f.documents} documents`)}
              footer="Your Box tree is the real one, so these are created as named. A folder here with one document is worth a second look."
            />
          )}

          {preview.unknownPeople.length > 0 && (
            <Detail
              title={`People with no account here (${preview.unknownPeople.length})`}
              tone="plain"
              lines={[preview.unknownPeople.join(', ')]}
              footer="Kept on each document as written. Nobody is created from a spreadsheet — add them under Settings first if you want these documents assigned."
            />
          )}

          {preview.ambiguousAmounts.length > 0 && (
            <Detail
              title={`Amounts left empty (${preview.ambiguousAmounts.length})`}
              tone="plain"
              lines={preview.ambiguousAmounts.map((n) => `Line ${n.line}: ${n.detail}`)}
              footer="The note names more than one figure and there is no way to tell the bill from the balance. Left blank rather than guessed."
            />
          )}

          <button className={BTN.primary} disabled={busy !== null} onClick={() => void commit()}>
            {busy === 'importing'
              ? 'Importing…'
              : `Import ${preview.willCreate + preview.willUpdate} rows`}
          </button>
        </div>
      )}
    </Card>
  )
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'navy' | 'gold'
}) {
  const ring =
    tone === 'navy'
      ? 'border-navy-500 bg-navy-50'
      : tone === 'gold'
        ? 'border-gold-500 bg-gold-100'
        : 'border-line bg-canvas'
  return (
    <div className={`rounded-lg border px-3 py-2 ${ring}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="text-[20px] font-extrabold tracking-tight text-navy-900">{value}</p>
    </div>
  )
}

function Detail({
  title,
  lines,
  footer,
  tone,
  open,
}: {
  title: string
  lines: string[]
  footer?: string
  tone: 'warn' | 'plain'
  open?: boolean
}) {
  return (
    <details
      open={open}
      className={`rounded-lg border px-3 py-2 ${
        tone === 'warn' ? 'border-gold-500 bg-gold-100/50' : 'border-line bg-canvas'
      }`}
    >
      <summary className="flex items-center gap-2 text-[13px] font-semibold text-navy-900">
        {tone === 'warn' && (
          <AlertTriangle className="size-4 text-gold-800" strokeWidth={2} aria-hidden />
        )}
        {title}
      </summary>
      {footer && <p className="mt-2 text-[12.5px] text-muted">{footer}</p>}
      <ul className="mt-2 max-h-64 space-y-0.5 overflow-y-auto text-[12.5px] text-ink">
        {lines.map((l) => (
          <li key={l} className="font-mono">
            {l}
          </li>
        ))}
      </ul>
    </details>
  )
}

type FileProgress = { done: number; total: number; name: string }

function Files({ direct }: { direct: boolean }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<FileProgress | null>(null)
  const [result, setResult] = useState<{ matched: number; unmatched: number; failed: string[] } | null>(
    null,
  )

  async function send(files: File[]) {
    if (files.length === 0) return
    setResult(null)

    let matched = 0
    let unmatched = 0
    const failed: string[] = []

    for (const [i, file] of files.entries()) {
      setProgress({ done: i, total: files.length, name: file.name })
      const contentType = file.type || 'application/pdf'
      try {
        const target = await prepareFile(file.name, contentType, file.size)

        let res
        if (target.mode === 'form') {
          const fd = new FormData()
          fd.set('file', file)
          res = await attachFileForm(fd)
        } else {
          const put = await fetch(target.url, {
            method: 'PUT',
            body: file,
            headers: { 'Content-Type': contentType },
          })
          if (!put.ok) throw new Error(`storage refused the upload (${put.status})`)
          res = await attachFile({
            documentId: target.documentId,
            key: target.key,
            filename: file.name,
            contentType,
            sha256: await hashFile(file),
          })
        }

        if (!res.ok) failed.push(`${file.name} — ${res.error}`)
        else if (res.matched) matched += 1
        else unmatched += 1
      } catch (err) {
        failed.push(`${file.name} — ${err instanceof Error ? err.message : 'failed'}`)
      }
    }

    setProgress(null)
    setResult({ matched, unmatched, failed })
    if (inputRef.current) inputRef.current.value = ''
    router.refresh()
  }

  return (
    <Card
      step={2}
      title="The PDFs"
      blurb="Unzip the Box download first, then drag whole folders in — subfolders and all. Each file is matched to its row by name."
    >
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          void send(Array.from(e.dataTransfer.files))
        }}
        className="rounded-xl border-2 border-dashed border-line p-8 text-center transition-colors hover:border-navy-500"
      >
        <span className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-navy-50 text-navy-500">
          <FolderOpen className="size-6" strokeWidth={1.6} aria-hidden />
        </span>
        <p className="text-[13.5px] text-muted">
          Drop a folder here, or{' '}
          <label className="cursor-pointer font-semibold text-navy-700 underline">
            choose files
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff"
              className="hidden"
              onChange={(e) => void send(Array.from(e.target.files ?? []))}
            />
          </label>
        </p>
        <p className="mt-1 text-[12px] text-subtle">
          {direct
            ? 'Files go straight from this browser to storage, so a big batch is fine.'
            : 'Local development: files go through the server, so keep batches small.'}
        </p>
      </div>

      {progress && (
        <div className="mt-3">
          <p className="text-[13px] text-muted">
            {progress.done + 1} of {progress.total} — {progress.name}
          </p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-navy-100">
            <div
              className="h-full bg-navy-700 transition-[width]"
              style={{ width: `${((progress.done + 1) / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {result && (
        <div className="mt-3 space-y-2">
          <p className="rounded-lg bg-ok-100 px-3 py-2 text-[13px] text-emerald-900">
            {result.matched} matched a spreadsheet row. {result.unmatched} matched nothing and were
            filed as new documents on Review.
          </p>
          {result.failed.length > 0 && (
            <Detail
              title={`Did not upload (${result.failed.length})`}
              tone="warn"
              open
              lines={result.failed}
            />
          )}
        </div>
      )}
    </Card>
  )
}

/** Same hint as the batch upload: a content hash for spotting a file scanned twice. */
async function hashFile(file: File): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null
  try {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    return null
  }
}
