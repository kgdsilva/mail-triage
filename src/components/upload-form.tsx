'use client'

import { useRouter } from 'next/navigation'
import { UploadCloud } from 'lucide-react'
import { useRef, useState } from 'react'
import { uploadBatch, type UploadResult } from '@/server/actions/documents'

export function UploadForm() {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<UploadResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (files.length === 0) return

    setBusy(true)
    setError(null)
    try {
      const fd = new FormData(formRef.current!)
      // The drop zone keeps its own list, so files dropped rather than picked are
      // included too. Clear whatever the input contributed first to avoid duplicates.
      fd.delete('files')
      files.forEach((f) => fd.append('files', f))

      const res = await uploadBatch(fd)
      setResult(res)
      setFiles([])
      formRef.current?.reset()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setBusy(false)
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
