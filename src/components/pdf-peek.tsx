'use client'

import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { ChevronDown, ExternalLink } from 'lucide-react'

/**
 * The document itself, read where the decision about it is made.
 *
 * Opening a PDF used to mean leaving for the classify screen — a form of a dozen
 * fields, when all that was wanted was a look at the page — or a new browser tab, which
 * loses the row you were on. Everywhere a document is listed, it expands in place
 * instead, and the frame only mounts once expanded so a list of forty does not fetch
 * forty PDFs.
 */
export function PdfFrame({
  id,
  title,
  hasFile,
  height = 'h-[32rem]',
}: {
  id: string
  title: string
  /** A historical row can exist before its PDF is attached; an iframe would 404. */
  hasFile: boolean
  height?: string
}) {
  return (
    <>
      {hasFile ? (
        <div className={`${height} overflow-hidden rounded-lg border border-line bg-line-soft`}>
          <iframe
            src={`/api/files/${id}#view=FitH&navpanes=0`}
            title={title}
            className="h-full w-full"
          />
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-line px-4 py-10 text-center text-[13px] text-muted">
          No file attached to this record.
        </p>
      )}
      <div className="mt-2 flex items-center justify-end">
        <Link
          href={`/classify/${id}`}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted transition-colors hover:text-navy-700"
        >
          <ExternalLink className="size-3.5" aria-hidden />
          Edit the details
        </Link>
      </div>
    </>
  )
}

/** The chevron on its own, for a caller that owns the expanded area. */
export function PeekToggle({
  open,
  onToggle,
  size = 'size-7',
}: {
  open: boolean
  onToggle: () => void
  size?: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={open ? 'Hide the document' : 'Show the document'}
      className={`grid ${size} place-items-center rounded-lg text-subtle transition-colors hover:bg-navy-50 hover:text-navy-700`}
    >
      <ChevronDown
        className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`}
        aria-hidden
      />
    </button>
  )
}

/**
 * A table row that opens the document underneath itself.
 *
 * `children` are the row's own cells; the chevron cell is appended here so every table
 * that uses this gets it in the same place. `colSpan` counts every cell in the row,
 * including that one.
 */
export function PeekRow({
  id,
  title,
  hasFile,
  colSpan,
  children,
}: {
  id: string
  title: string
  hasFile: boolean
  colSpan: number
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <tr
        className={`transition-colors ${open ? 'bg-navy-50/70' : 'hover:bg-navy-50/60'}`}
      >
        {children}
        <td className="w-10 whitespace-nowrap py-3 pr-3 text-right align-top">
          <PeekToggle open={open} onToggle={() => setOpen((v) => !v)} />
        </td>
      </tr>
      {open && (
        <tr className="bg-navy-50/40">
          <td colSpan={colSpan} className="px-4 pb-4">
            <PdfFrame id={id} title={title} hasFile={hasFile} height="h-[34rem]" />
          </td>
        </tr>
      )}
    </>
  )
}
