'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActionKind, Disposition, DispositionReason, DocStatus } from '@/generated/prisma/enums'
import { saveClassification } from '@/server/actions/documents'
import {
  findOrCreateVendor,
  getSuggestion,
  searchVendors,
  type Suggestion,
} from '@/server/actions/classify-support'

type Doc = {
  id: string
  originalFilename: string
  finalFilename: string | null
  entityId: string | null
  documentTypeId: string | null
  vendorId: string | null
  vendorName: string
  documentDate: string
  dueDate: string
  amount: string
  disposition: Disposition
  dispositionReason: DispositionReason | null
  status: DocStatus
  storageFolderId: string | null
  summaryNote: string
  internalNotes: string
  assignedToUserId: string | null
  actionKind: ActionKind | null
}

const ARCHIVE_REASONS: DispositionReason[] = [
  'AUTOPAY',
  'INCOMING_CHECK',
  'SPAM_SOLICITATION',
  'FYI_STATEMENT',
  'OTHER',
]

const ACTION_REASONS: DispositionReason[] = [
  'DEADLINE_NOTICE',
  'MANUAL_INVOICE',
  'RISK_PENALTY',
  'OTHER',
]

export function ClassifyForm({
  document: doc,
  entities,
  types,
  folders,
  people,
  nextId,
}: {
  document: Doc
  entities: { id: string; code: string; legalName: string }[]
  types: { id: string; code: string; label: string }[]
  folders: { id: string; pathCache: string }[]
  people: { id: string; label: string }[]
  nextId: string | null
}) {
  const router = useRouter()
  const [form, setForm] = useState(doc)
  const [vendorQuery, setVendorQuery] = useState(doc.vendorName)
  const [vendorHits, setVendorHits] = useState<{ id: string; name: string; knownSpam: boolean }[]>([])
  const [vendorOpen, setVendorOpen] = useState(false)
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Whether the operator has taken over the decision. Until they do, the suggestion
  // drives the disposition; once they choose, their choice stands and is never
  // overwritten by a later re-suggestion.
  const decisionTouched = useRef(doc.disposition !== 'UNREVIEWED')

  // Whether the stored filename was written by hand rather than generated.
  // "A filename exists" is not the same thing: every saved document has one, and
  // treating that as an edit would freeze the suggestion forever after the first save.
  // Instead the first suggestion decides — if the stored name matches what the
  // convention produces for these fields, it was generated and keeps tracking; if it
  // differs, someone typed it and it is left alone.
  const filenameTouched = useRef(false)
  const filenameChecked = useRef(false)

  const set = <K extends keyof Doc>(key: K, value: Doc[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  // --- live suggestion ----------------------------------------------------
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      const s = await getSuggestion({
        entityId: form.entityId,
        documentTypeId: form.documentTypeId,
        vendorId: form.vendorId,
        documentDate: form.documentDate || null,
        amount: form.amount || null,
        extension: form.originalFilename.split('.').pop() ?? 'pdf',
      })
      if (cancelled) return

      setSuggestion(s)
      if (!decisionTouched.current && s.verdict.disposition !== 'UNREVIEWED') {
        setForm((f) => ({
          ...f,
          disposition: s.verdict.disposition,
          dispositionReason: s.verdict.reason,
          status: s.verdict.disposition === 'ARCHIVE' ? 'ARCHIVED' : 'WAITING',
          storageFolderId: f.storageFolderId ?? s.folderId,
        }))
      }
      if (!filenameChecked.current) {
        filenameChecked.current = true
        if (doc.finalFilename && doc.finalFilename !== s.filename) {
          filenameTouched.current = true
        }
      }
      if (!filenameTouched.current) {
        setForm((f) => ({ ...f, finalFilename: s.filename }))
      }
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [
    form.entityId,
    form.documentTypeId,
    form.vendorId,
    form.documentDate,
    form.amount,
    form.originalFilename,
    doc.finalFilename,
  ])

  // --- vendor combobox ----------------------------------------------------
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      const hits = await searchVendors(vendorQuery)
      if (!cancelled) setVendorHits(hits)
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [vendorQuery])

  async function commitVendor(name: string) {
    const v = await findOrCreateVendor(name)
    setForm((f) => ({ ...f, vendorId: v.id }))
    setVendorQuery(v.name)
    setVendorOpen(false)
  }

  // --- save ---------------------------------------------------------------
  const save = useCallback(
    async (advance: boolean) => {
      setBusy(true)
      setError(null)

      const fd = new FormData()
      fd.set('documentId', form.id)
      fd.set('entityId', form.entityId ?? '')
      fd.set('documentTypeId', form.documentTypeId ?? '')
      fd.set('vendorId', form.vendorId ?? '')
      fd.set('storageFolderId', form.storageFolderId ?? '')
      fd.set('assignedToUserId', form.assignedToUserId ?? '')
      fd.set('actionKind', form.actionKind ?? '')
      fd.set('documentDate', form.documentDate)
      fd.set('dueDate', form.dueDate)
      fd.set('amount', form.amount)
      fd.set('disposition', form.disposition)
      fd.set('dispositionReason', form.dispositionReason ?? '')
      fd.set('status', form.status)
      fd.set('finalFilename', form.finalFilename ?? '')
      fd.set('summaryNote', form.summaryNote)
      fd.set('internalNotes', form.internalNotes)

      const res = await saveClassification({ ok: false }, fd)
      setBusy(false)

      if (!res.ok) {
        setError(res.error ?? 'Could not save.')
        return
      }
      if (advance && nextId) router.push(`/classify/${nextId}`)
      else if (advance) router.push('/classify')
      else router.refresh()
    },
    [form, nextId, router],
  )

  // Cmd/Ctrl+Enter saves and moves on — the batch rhythm this screen is built for.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        void save(!e.shiftKey)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])

  const needsDecision = form.disposition === 'UNREVIEWED'
  const needsReason = form.disposition === 'ARCHIVE' && !form.dispositionReason
  // A document must not leave this screen without a recorded decision.
  const blocked = needsDecision || needsReason
  const reasons = form.disposition === 'ARCHIVE' ? ARCHIVE_REASONS : ACTION_REASONS

  return (
    <div className="flex h-[calc(100vh-190px)] min-h-[520px] flex-col gap-3 overflow-y-auto rounded border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      {/* --- suggestion ---------------------------------------------------- */}
      {suggestion && suggestion.verdict.disposition !== 'UNREVIEWED' && (
        <div
          className={`rounded px-3 py-2 text-xs ${
            suggestion.verdict.ambiguous
              ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100'
              : 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'
          }`}
        >
          <span className="font-medium">
            {suggestion.verdict.ambiguous ? 'Needs a look: ' : 'Suggested: '}
            {suggestion.verdict.disposition === 'ARCHIVE' ? 'Archive' : 'Send for action'}
          </span>
          <span className="ml-1">{suggestion.verdict.rationale}</span>
        </div>
      )}

      <Row label="Entity">
        <select
          autoFocus
          value={form.entityId ?? ''}
          onChange={(e) => set('entityId', e.target.value || null)}
          className={inputClass}
        >
          <option value="">—</option>
          {entities.map((e) => (
            <option key={e.id} value={e.id}>
              {e.code} · {e.legalName}
            </option>
          ))}
        </select>
      </Row>

      <Row label="Type">
        <select
          value={form.documentTypeId ?? ''}
          onChange={(e) => set('documentTypeId', e.target.value || null)}
          className={inputClass}
        >
          <option value="">—</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </Row>

      <Row label="Vendor">
        <div className="relative">
          <input
            value={vendorQuery}
            onChange={(e) => {
              setVendorQuery(e.target.value)
              setVendorOpen(true)
              // Typing invalidates the previously selected vendor until re-committed.
              set('vendorId', null)
            }}
            onFocus={() => setVendorOpen(true)}
            onBlur={() => setTimeout(() => setVendorOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && vendorQuery.trim()) {
                e.preventDefault()
                void commitVendor(vendorQuery)
              }
            }}
            placeholder="Berkheimer…"
            className={inputClass}
          />
          {vendorOpen && vendorQuery.trim() && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded border border-neutral-300 bg-white text-xs shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
              {vendorHits.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => commitVendor(v.name)}
                    className="flex w-full items-center justify-between px-2 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    {v.name}
                    {v.knownSpam && <span className="text-red-600">solicitation</span>}
                  </button>
                </li>
              ))}
              {!vendorHits.some((v) => v.name.toLowerCase() === vendorQuery.trim().toLowerCase()) && (
                <li>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => commitVendor(vendorQuery)}
                    className="w-full px-2 py-1.5 text-left text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                  >
                    Create “{vendorQuery.trim()}”
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      </Row>

      <div className="grid grid-cols-3 gap-2">
        <Field label="Document date">
          <input
            type="date"
            value={form.documentDate}
            onChange={(e) => set('documentDate', e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Due date">
          <input
            type="date"
            value={form.dueDate}
            onChange={(e) => set('dueDate', e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Amount">
          <input
            inputMode="decimal"
            value={form.amount}
            onChange={(e) => set('amount', e.target.value)}
            placeholder="255.00"
            className={inputClass}
          />
        </Field>
      </div>

      {/* --- the decision -------------------------------------------------- */}
      <div className="rounded border border-neutral-200 p-3 dark:border-neutral-800">
        <p className="mb-2 text-xs font-medium text-neutral-600 dark:text-neutral-400">Decision</p>
        <div className="flex gap-2">
          {(['ARCHIVE', 'ACTION'] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => {
                decisionTouched.current = true
                setForm((f) => ({
                  ...f,
                  disposition: d,
                  // Reason belongs to the decision; carrying one across would let an
                  // "autopay" reason end up on an action item.
                  dispositionReason: null,
                  status: d === 'ARCHIVE' ? 'ARCHIVED' : 'WAITING',
                }))
              }}
              className={`flex-1 rounded px-3 py-2 text-sm font-medium ${
                form.disposition === d
                  ? d === 'ACTION'
                    ? 'bg-amber-500 text-white'
                    : 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                  : 'border border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-400'
              }`}
            >
              {d === 'ARCHIVE' ? 'Archive' : 'Send for action'}
            </button>
          ))}
        </div>

        {form.disposition !== 'UNREVIEWED' && (
          <div className="mt-2">
            <select
              value={form.dispositionReason ?? ''}
              onChange={(e) => set('dispositionReason', (e.target.value || null) as DispositionReason | null)}
              className={`${inputClass} ${needsReason ? 'border-red-500' : ''}`}
            >
              <option value="">
                {form.disposition === 'ARCHIVE' ? 'Reason (required)' : 'Reason (optional)'}
              </option>
              {reasons.map((r) => (
                <option key={r} value={r}>
                  {r.toLowerCase().replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            {needsReason && (
              <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">
                Archiving needs a stated reason — it is what makes the decision auditable later.
              </p>
            )}
          </div>
        )}
      </div>

      {form.disposition === 'ACTION' && (
        <Field label="What does this need?">
          <div className="flex gap-1.5">
            {ACTION_KINDS.map(({ value, label, hint }) => (
              <button
                key={value}
                type="button"
                title={hint}
                onClick={() => set('actionKind', value)}
                className={`flex-1 rounded border px-2 py-1.5 text-xs ${
                  (form.actionKind ?? 'REVIEW') === value
                    ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
                    : 'border-neutral-300 dark:border-neutral-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>
      )}

      {form.disposition === 'ACTION' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Route to">
            <select
              value={form.assignedToUserId ?? ''}
              onChange={(e) => set('assignedToUserId', e.target.value || null)}
              className={inputClass}
            >
              <option value="">Unassigned</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              value={form.status}
              onChange={(e) => set('status', e.target.value as DocStatus)}
              className={inputClass}
            >
              <option value="WAITING">Waiting</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="DONE">Done</option>
            </select>
          </Field>
        </div>
      )}

      <Field label="Note — plain language, for whoever this goes to">
        <textarea
          value={form.summaryNote}
          onChange={(e) => set('summaryNote', e.target.value)}
          rows={2}
          className={inputClass}
        />
      </Field>

      <Field label="Filename">
        <input
          value={form.finalFilename ?? ''}
          onChange={(e) => {
            filenameTouched.current = true
            set('finalFilename', e.target.value)
          }}
          className={`${inputClass} font-mono text-xs`}
        />
      </Field>

      <Field label="File into">
        <select
          value={form.storageFolderId ?? ''}
          onChange={(e) => set('storageFolderId', e.target.value || null)}
          className={inputClass}
        >
          <option value="">—</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.pathCache}
            </option>
          ))}
        </select>
      </Field>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-auto flex items-center gap-2 pt-2">
        <button
          onClick={() => save(true)}
          disabled={busy || blocked}
          className="flex-1 rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {busy ? 'Saving…' : nextId ? 'Save & next' : 'Save & finish'}
        </button>
        <button
          onClick={() => save(false)}
          disabled={busy || blocked}
          className="rounded border border-neutral-300 px-3 py-2 text-sm disabled:opacity-40 dark:border-neutral-700"
        >
          Save
        </button>
      </div>
      <p className="text-center text-[11px] text-neutral-500">
        {needsDecision
          ? 'Choose Archive or Send for action to save'
          : '⌘↵ save & next · ⇧⌘↵ save & stay'}
      </p>
    </div>
  )
}

const inputClass =
  'w-full rounded border border-neutral-300 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-300'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[80px_minmax(0,1fr)] items-center gap-2">
      <span className="text-xs text-neutral-600 dark:text-neutral-400">{label}</span>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-neutral-600 dark:text-neutral-400">{label}</span>
      {children}
    </label>
  )
}

/**
 * What a document asks of whoever it lands on. This lives on the document, not on the
 * person: the same colleague may confirm one item and pay the next, so there is no
 * permanent "payer" or "confirmer".
 */
const ACTION_KINDS: { value: ActionKind; label: string; hint: string }[] = [
  { value: 'PAY', label: 'Pay', hint: 'A bill to pay — amount and due date are what matter' },
  {
    value: 'CONFIRM',
    label: 'Confirm',
    hint: 'Needs a decision or verification before any money moves',
  },
  { value: 'REVIEW', label: 'Review', hint: 'Someone should look at it; nothing to pay yet' },
]
