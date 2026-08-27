'use client'

import { useRouter } from 'next/navigation'
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
      className="space-y-4 rounded border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <label className="block">
        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">
          Batch label
        </span>
        <input
          name="label"
          placeholder="2026-08 mail"
          className="mt-1 w-full rounded border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-300"
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
        className={`rounded border-2 border-dashed p-8 text-center transition-colors ${
          dragging
            ? 'border-neutral-900 bg-neutral-50 dark:border-neutral-300 dark:bg-neutral-800'
            : 'border-neutral-300 dark:border-neutral-700'
        }`}
      >
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Drop scans here, or{' '}
          <label className="cursor-pointer underline">
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
        <p className="mt-1 text-xs text-neutral-500">PDF, JPG, PNG or TIFF · up to 50 MB each</p>
      </div>

      {files.length > 0 && (
        <ul className="max-h-52 space-y-1 overflow-y-auto text-xs">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center justify-between rounded bg-neutral-50 px-2 py-1 dark:bg-neutral-800"
            >
              <span className="truncate">{f.name}</span>
              <button
                type="button"
                onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                className="ml-2 shrink-0 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {result && (
        <div className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
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
        className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {busy ? 'Uploading…' : `Upload ${files.length || ''}`.trim()}
      </button>
    </form>
  )
}
