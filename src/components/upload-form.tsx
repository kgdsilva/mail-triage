'use client'

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

export function UploadForm() {
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
      const { batchId, direct } = await beginUpload(label)

      if (!direct || !batchId) {
        const fd = new FormData()
        fd.set('label', label)
        files.forEach((f) => fd.append('files', f))
        setResult(await uploadBatch(fd))
      } else {
        const skipped: string[] = []
        let created = 0

        for (const [i, file] of files.entries()) {
          setProgress({ done: i, total: files.length, name: file.name })
          const contentType = file.type || 'application/pdf'

          try {
            const { key, url } = await signUpload(batchId, file.name, contentType, file.size)

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
            if (res.ok) created += 1
            else skipped.push(`${file.name} (${res.error})`)
          } catch (err) {
            skipped.push(`${file.name} (${err instanceof Error ? err.message : 'failed'})`)
          }
        }

        setResult({ batchId, created, skipped })
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
          <label className="cursor-pointer font-medium text-navy-700 underline">
            browse
            <input
              type="file"
              name="files"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff"
              className="hidden"
              onChange={(e) => setFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])])}
            />
          </label>
        </p>
        <p className="mt-1 text-[12.5px] text-subtle">PDF, JPG, PNG or TIFF · up to 50 MB each</p>
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

      {result && (
        <div className="rounded-lg bg-ok-100 px-3 py-2 text-sm text-emerald-900">
          <p>
            {result.created} document{result.created === 1 ? '' : 's'} added.{' '}
            <a href="/classify" className="underline">
              Start classifying
            </a>
          </p>
          {result.skipped.length > 0 && (
            <ul className="mt-1 text-xs">
              {result.skipped.map((s) => (
                <li key={s}>Skipped {s}</li>
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
