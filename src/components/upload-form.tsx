'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { UploadCloud } from 'lucide-react'
import { useRef, useState } from 'react'
import {
  attachUpload,
  beginUpload,
  signUpload,
  uploadBatch,
  type UploadResult,
} from '@/server/actions/documents'

/**
 * An iPhone photo, turned into something the rest of the system can read.
 *
 * HEIC is what a phone produces by default and nothing downstream opens it: not the
 * browser preview, not the PDF frame, not the model that reads the page. Before this it
 * was simply refused at the door, which in practice meant "photograph the bill with
 * something that is not your phone".
 *
 * Converted in the browser, before the upload, for two reasons. A HEIC is often several
 * megabytes and the JPEG is a fraction of it, so the slow part of the trip carries less;
 * and the server never has to hold a format it cannot read anyway.
 *
 * The library is loaded only when a HEIC is actually chosen. It is 1.3 MB — a whole
 * image codec compiled to JavaScript — and making everyone who uploads a PDF pay for it
 * would be the wrong trade. Imported this way it costs nothing until the moment it is
 * the only thing that helps.
 */
async function toJpegIfHeic(file: File): Promise<File> {
  const looksHeic =
    /^image\/hei[cf]$/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)
  if (!looksHeic) return file

  const { default: heic2any } = await import('heic2any')
  const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 })
  const blob = Array.isArray(out) ? out[0] : out
  const renamed = file.name.replace(/\.(heic|heif)$/i, '.jpg')
  return new File([blob], renamed, { type: 'image/jpeg', lastModified: file.lastModified })
}

/** What the server will take, once this form has finished preparing things. */
const KEEP = /\.(pdf|jpe?g|png|tiff?|heic|heif)$/i
const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif',
}

const isZip = (f: File) =>
  /\.zip$/i.test(f.name) || /^application\/(x-)?zip(-compressed)?$/i.test(f.type)

/**
 * A scan dropped in as one archive, opened here rather than refused.
 *
 * The scanner was zipping the day's post and dropping the archive in, which is the
 * obvious thing to do with fifty files and was the one thing this form could not take.
 * Every file inside was refused individually, by a server that had never been told what
 * a zip is — and the result said so in a green box, so nobody read it.
 *
 * Opened in the browser, so what reaches the server is what it already understands: one
 * file per document, each through the same path, with the same duplicate check and the
 * same history. Nothing downstream knows an archive was involved, which is the point —
 * a zip is how the post arrived, not a kind of document.
 *
 * `fflate` is imported only when an archive actually turns up, the same bargain the
 * HEIC converter makes: a decompressor costs nothing until it is the only thing that
 * helps.
 */
async function expandArchives(files: File[]): Promise<{ files: File[]; ignored: string[] }> {
  if (!files.some(isZip)) return { files, ignored: [] }

  const { unzipSync } = await import('fflate')
  const out: File[] = []
  const ignored: string[] = []

  for (const file of files) {
    if (!isZip(file)) {
      out.push(file)
      continue
    }

    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
    for (const [path, bytes] of Object.entries(entries)) {
      const name = path.split('/').pop() ?? path

      /*
       * Folders, and the metadata a Mac puts beside every file it compresses. Without
       * this, zipping on a Mac produces a second, empty copy of every document named
       * "._invoice.pdf", and the person is told their fifty-file archive held a hundred.
       */
      if (bytes.length === 0 || path.endsWith('/')) continue
      if (path.startsWith('__MACOSX/') || name.startsWith('._') || name === '.DS_Store') continue

      if (!KEEP.test(name)) {
        ignored.push(`${name} — not a document this can open`)
        continue
      }

      const ext = name.split('.').pop()?.toLowerCase() ?? ''
      out.push(
        new File([bytes as BlobPart], name, {
          type: MIME[ext] ?? 'application/octet-stream',
          lastModified: file.lastModified,
        }),
      )
    }
  }

  return { files: out, ignored }
}

export function UploadForm({ canClassify }: { canClassify: boolean }) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<UploadResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(
    null,
  )

  /**
   * Uploads go straight from here to object storage when it is configured.
   *
   * Not for speed: a serverless function's request body is capped at 4.5 MB, so a 50 MB
   * scan is rejected by the platform before it ever reaches a server action. Signing a
   * URL and PUTting the bytes to storage is the only path these files have. Local
   * development has no object storage, so the server reports direct: false and the
   * whole batch goes through the original form-data action instead.
   */
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (files.length === 0) return

    setBusy(true)
    setError(null)
    setProgress(null)

    const label = String(new FormData(formRef.current!).get('label') ?? '')

    try {
      /*
       * Phone photos become JPEGs before anything else happens, so both upload paths
       * and everything downstream see a format they can actually open.
       */
      setProgress({ done: 0, total: files.length, name: 'Preparing…' })

      /*
       * Archives first, phone photos second — an archive can hold phone photos, and
       * converting before opening would miss every one of them.
       */
      let opened: File[]
      let ignoredInArchive: string[] = []
      try {
        const expanded = await expandArchives(files)
        opened = expanded.files
        ignoredInArchive = expanded.ignored
      } catch {
        setError('That archive could not be opened. It may be damaged, or password-protected.')
        setBusy(false)
        setProgress(null)
        return
      }

      if (opened.length === 0) {
        setError(
          ignoredInArchive.length > 0
            ? `Nothing in that archive is a document this can open. It held ${ignoredInArchive.length} other file${ignoredInArchive.length === 1 ? '' : 's'}.`
            : 'That archive is empty.',
        )
        setBusy(false)
        setProgress(null)
        return
      }

      let ready: File[]
      try {
        ready = await Promise.all(opened.map(toJpegIfHeic))
      } catch {
        setError('That iPhone photo could not be converted. Export it as JPEG and try again.')
        setBusy(false)
        setProgress(null)
        return
      }

      const { batchId, direct } = await beginUpload(label)

      if (!direct || !batchId) {
        const fd = new FormData()
        fd.set('label', label)
        ready.forEach((f) => fd.append('files', f))
        /* The archive's own refusals belong in the result on this path too — it is
           the one that runs wherever object storage is not configured, and a file
           quietly dropped on the way in is the thing this screen keeps getting wrong. */
        const batchResult = await uploadBatch(fd)
        setResult({ ...batchResult, skipped: [...ignoredInArchive, ...batchResult.skipped] })
      } else {
        const skipped: string[] = []
        const duplicates: string[] = []
        let created = 0

        for (const [i, file] of ready.entries()) {
          setProgress({ done: i, total: ready.length, name: file.name })
          const contentType = file.type || 'application/pdf'

          try {
            const signed = await signUpload(batchId, file.name, contentType, file.size)
            if (!signed.ok) {
              skipped.push(`${file.name} — ${signed.error}`)
              continue
            }
            const { key, url } = signed

            const put = await fetch(url, {
              method: 'PUT',
              body: file,
              headers: { 'Content-Type': contentType },
            })
            if (!put.ok) throw new Error(`storage refused the upload (${put.status})`)

            const res = await attachUpload({
              batchId,
              key,
              filename: file.name,
              contentType,
              sha256: await hashFile(file),
            })
            if (res.ok && res.duplicate) duplicates.push(file.name)
            else if (res.ok) created += 1
            else skipped.push(`${file.name} (${res.error})`)
          } catch (err) {
            skipped.push(`${file.name} (${err instanceof Error ? err.message : 'failed'})`)
          }
        }

        setResult({ batchId, created, skipped: [...ignoredInArchive, ...skipped], duplicates })
      }

      setFiles([])
      formRef.current?.reset()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      className="space-y-4 rounded-lg border border-line bg-surface p-5"
    >
      <label className="block">
        <span className="text-xs font-medium text-muted">
          Batch label
        </span>
        <input
          name="label"
          placeholder="2026-08 mail"
          className="mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-1.5 text-sm outline-none focus:border-navy-500"
        />
      </label>

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          setFiles((prev) => [...prev, ...Array.from(e.dataTransfer.files)])
        }}
        className={`rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
          dragging ? 'border-navy-500 bg-navy-50' : 'border-line hover:border-navy-500'
        }`}
      >
        <span className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-navy-50 text-navy-500">
          <UploadCloud className="size-6" strokeWidth={1.6} aria-hidden />
        </span>
        <p className="text-[14px] text-muted">
          Drop scans here, or{' '}
          {/* HEIC and ZIP are offered because this form deals with both before anything
              is sent: an iPhone photograph is converted to JPEG, and an archive is
              opened and its contents uploaded one by one. The server never sees either
              format, which is why its own list is shorter than this one.

              Removing HEIC from here earlier today was a mistake: the converter has
              been in this file since before I touched it, and taking the format out of
              the picker broke a path that worked. */}
          <label className="cursor-pointer font-medium text-navy-700 underline">
            browse
            <input
              type="file"
              name="files"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff,.heic,.heif,.zip"
              className="hidden"
              onChange={(e) => setFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])])}
            />
          </label>
        </p>
        <p className="mt-1 text-[12.5px] text-subtle">
          PDF, JPG, PNG, TIFF or an iPhone photo · up to 50 MB each. A .zip is opened
          here and its documents uploaded one by one.
        </p>
      </div>

      {files.length > 0 && (
        <ul className="max-h-52 space-y-1 overflow-y-auto text-xs">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center justify-between rounded-lg bg-navy-50 px-2 py-1"
            >
              <span className="truncate">{f.name}</span>
              <button
                type="button"
                onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                className="ml-2 shrink-0 text-muted hover:text-ink"
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-sm text-danger-700">{error}</p>}

      {/*
        Green only when something actually arrived.

        This box was green whatever happened. The scanner dropped fifty-four files, every
        one of them was refused, and she was shown a green panel reading "0 documents
        added" with the reasons underneath in the smallest type on the page. She reported
        it as "I uploaded 54 things", which is what the screen told her.

        A result that is mostly failure is not a success with a footnote.
      */}
      {result && (
        <div
          className={`rounded-lg px-3 py-2 text-sm ${
            result.created === 0 && result.skipped.length > 0
              ? 'bg-danger-100 text-danger-700'
              : result.skipped.length > 0
                ? 'bg-gold-100 text-gold-800'
                : 'bg-ok-100 text-emerald-900'
          }`}
        >
          {/*
            The scanner has no classify screen, so telling her to go there would be a
            link to a redirect. "Somebody will pick these up" is the true version of
            what happens next, and it is also the whole of her job description.
          */}
          <p className={result.created === 0 && result.skipped.length > 0 ? 'font-bold' : ''}>
            {result.created === 0 && result.skipped.length > 0 ? (
              <>
                Nothing was added. {result.skipped.length} file
                {result.skipped.length === 1 ? '' : 's'} were refused — the reason for
                each is below.
              </>
            ) : (
              <>
                {result.created} document{result.created === 1 ? '' : 's'} added.{' '}
                {result.skipped.length > 0 && (
                  <>
                    {result.skipped.length} refused.{' '}
                  </>
                )}
                {canClassify ? (
                  <Link href="/classify" className="underline">
                    Start classifying
                  </Link>
                ) : (
                  <span>Nothing else to do — these are now in the queue to be reviewed.</span>
                )}
              </>
            )}
          </p>
          {/*
            An identical file is not an error and not a skip — it was recognised and
            taken straight back out, which is the whole point. Said plainly so the short
            count is never a mystery, and said with the way back, because "removed" is
            the one word in here that people want to be able to undo.
          */}
          {result.duplicates.length > 0 && (
            <p className="mt-1.5 text-xs">
              {result.duplicates.length} file{result.duplicates.length === 1 ? ' was' : 's were'}{' '}
              already in the log and {result.duplicates.length === 1 ? 'was' : 'were'} removed as
              duplicate{result.duplicates.length === 1 ? '' : 's'}:{' '}
              <span className="font-medium">{result.duplicates.join(', ')}</span>.{' '}
              <Link href="/log?deleted=1" className="underline">
                See removed
              </Link>
            </p>
          )}
          {/* The reasons, at a size somebody can read, because they are the content of
              this message rather than a footnote to it. */}
          {result.skipped.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[12.5px]">
              {result.skipped.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={busy || files.length === 0}
        className="rounded-lg bg-navy-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
      >
        {busy ? 'Uploading…' : `Upload ${files.length || ''}`.trim()}
      </button>
    </form>
  )
}

/**
 * SHA-256 of the file, for spotting a document that was scanned twice.
 *
 * Computed in the browser because with a direct upload the bytes never pass through the
 * server. That makes it a hint rather than a guarantee — a wrong value costs a missed
 * duplicate warning, nothing more — so a failure here is not worth failing an upload
 * over. Requires a secure context; on plain http it returns null and the document is
 * simply stored without a hash.
 */
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
