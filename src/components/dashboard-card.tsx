'use client'

import { useState } from 'react'
import { ArrowRightLeft, Ban, Check, FolderInput, Hand, Wallet } from 'lucide-react'
import {
  claimDocument,
  handOffDocument,
  resolveDocument,
  undoAction,
} from '@/server/actions/documents'
import { DueBadge } from '@/components/badges'
import { PaymentForm, type PaymentEntity } from '@/components/payment-form'
import { PdfFrame, PeekToggle } from '@/components/pdf-peek'
import {
  ACTION_KINDS,
  BTN,
  CARD,
  documentTypeIcon,
  documentTypeTone,
  entityAccent,
  entityColor,
} from '@/lib/theme'

export type CardDoc = {
  id: string
  title: string
  summaryNote: string | null
  amount: string | null
  dueDate: string | null
  actionKind: string | null
  entityId: string | null
  entityCode: string | null
  entityIndex: number
  typeCode: string | null
  vendorName: string | null
  typeLabel: string | null
  /** Who owns it right now, or null when it is routed to nobody. */
  assigneeName: string | null
  mine: boolean
  /** A historical row can exist before its PDF is attached; an iframe would 404. */
  hasFile: boolean
}

/**
 * One item on the board, with everything a person actually does when they look at it.
 *
 * There are four answers to "what do I do with this?", and until now the card offered
 * two. You can pay it and record the proof, hand it to whoever does the next step,
 * finish it, or find that it needed nothing — a solicitation, or something real that
 * only wanted filing. That last pair was the gap: the only place to say "this is spam"
 * was the triage screen, so the person the document was routed *to* could not say it.
 *
 * Money sits large on the right because it is what the person paying is looking for.
 * The company is the loudest signal — a coloured edge and a tag — because that is the
 * first question anyone asks of a piece of mail. What it wants from you, and whose it
 * is, are quiet pills beside the name: one queue mixes paying, confirming and reading,
 * and splitting that into three lists made a short queue look like three chores.
 */
export function DocumentCard({
  doc,
  people,
  entities,
  canDecide,
}: {
  doc: CardDoc
  people: { id: string; label: string }[]
  entities: PaymentEntity[]
  /** False for a VIEWER, who reads the board and changes nothing on it. */
  canDecide: boolean
}) {
  const [handingOff, setHandingOff] = useState(false)
  const [paying, setPaying] = useState(false)
  const [open, setOpen] = useState(false)
  const Icon = documentTypeIcon(doc.typeCode)
  const ask = doc.actionKind ? ACTION_KINDS[doc.actionKind as keyof typeof ACTION_KINDS] : null

  return (
    <div className={`${CARD} relative overflow-hidden p-4 pl-5`}>
      <span
        className={`absolute inset-y-0 left-0 w-1.5 ${doc.entityCode ? entityAccent(doc.entityCode, doc.entityIndex) : 'bg-line'}`}
        aria-hidden
      />

      <div className="flex gap-3.5">
        <span
          className={`grid size-10 flex-none place-items-center rounded-[10px] ${documentTypeTone(doc.typeCode)}`}
          aria-hidden
        >
          <Icon className="size-5" strokeWidth={1.9} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {doc.entityCode && (
              <span
                className={`rounded-full px-2 py-0.5 font-mono text-[11px] font-bold tracking-wider ${entityColor(doc.entityCode, doc.entityIndex)}`}
              >
                {doc.entityCode}
              </span>
            )}
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="truncate text-left text-[15px] font-bold text-navy-900 hover:underline"
            >
              {doc.vendorName ?? doc.title}
            </button>
            {ask && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full pl-1.5 pr-2 py-0.5 text-[11px] font-semibold ${ask.tone}`}
              >
                <span className={`size-1.5 rounded-full ${ask.dot}`} aria-hidden />
                {ask.label}
              </span>
            )}
            {/*
              Whose it is, on a shared board. "Nobody yet" is the important one: an
              action item routed to no one is what everybody assumes somebody else has.
            */}
            {doc.assigneeName ? (
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  doc.mine ? 'bg-navy-100 text-navy-900' : 'bg-line-soft text-muted'
                }`}
              >
                {doc.mine ? 'You' : doc.assigneeName}
              </span>
            ) : (
              <span className="rounded-full bg-gold-100 px-2 py-0.5 text-[11px] font-bold text-gold-800">
                Nobody yet
              </span>
            )}
            {doc.typeLabel && (
              <span className="text-[12.5px] font-medium text-subtle">{doc.typeLabel}</span>
            )}
          </div>

          {doc.summaryNote && (
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{doc.summaryNote}</p>
          )}

          {canDecide && (
            <div className="mt-3.5 flex flex-wrap items-center gap-2">
              {/*
                Paying is first and green for a bill, because on a bill it is the answer;
                for anything else the answer is "done", so that takes the green instead.
                Two green buttons on one card would make neither of them mean anything.
              */}
              {doc.actionKind === 'PAY' ? (
                <button
                  type="button"
                  onClick={() => setPaying((v) => !v)}
                  className={paying ? BTN.secondary : BTN.done}
                >
                  <Wallet className="size-3.5" aria-hidden />
                  {paying ? 'Cancel' : 'Mark paid'}
                </button>
              ) : (
                <form action={resolveDocument.bind(null, doc.id)}>
                  <button className={BTN.done}>
                    <Check className="size-3.5" aria-hidden />
                    Mark done
                  </button>
                </form>
              )}

              <button
                type="button"
                onClick={() => setHandingOff((v) => !v)}
                className={BTN.secondary}
              >
                <ArrowRightLeft className="size-3.5" aria-hidden />
                {handingOff ? 'Cancel' : 'Hand off'}
              </button>

              {!doc.assigneeName && (
                <form action={claimDocument.bind(null, doc.id)}>
                  <button className={BTN.secondary}>
                    <Hand className="size-3.5" aria-hidden />
                    I&rsquo;ll take it
                  </button>
                </form>
              )}

              {doc.actionKind === 'PAY' && (
                <form action={resolveDocument.bind(null, doc.id)}>
                  <button className={BTN.quiet} title="Finish it without recording a payment">
                    <Check className="size-3.5" aria-hidden />
                    Done, no payment
                  </button>
                </form>
              )}

              {/*
                "It needed nothing" pushed to the right and quiet. It is the least
                common answer and the one that removes an item from everybody's view, so
                it should not sit under the thumb next to the button people press all day.
              */}
              <span className="ml-auto flex items-center gap-1.5">
                <form action={undoAction.bind(null, doc.id, 'ARCHIVE')}>
                  <button className={BTN.quiet} title="Real, but nothing to do — just file it">
                    <FolderInput className="size-3.5" aria-hidden />
                    Just filing
                  </button>
                </form>
                <form action={undoAction.bind(null, doc.id, 'SPAM')}>
                  <button className={BTN.danger} title="A solicitation dressed up as a notice">
                    <Ban className="size-3.5" aria-hidden />
                    Spam
                  </button>
                </form>
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-none items-start gap-2">
          <div className="flex flex-col items-end gap-1.5 text-right">
            {doc.amount && (
              <span className="display tabular text-[22px] font-extrabold tracking-tight text-navy-900">
                ${doc.amount}
              </span>
            )}
            {/* No due date is simply absent here — a dash would dangle under the amount. */}
            {doc.dueDate && <DueBadge date={doc.dueDate} />}
          </div>

          <PeekToggle open={open} onToggle={() => setOpen((v) => !v)} />
        </div>
      </div>

      {open && (
        <div className="mt-3.5 border-t border-line-soft pt-3.5">
          <PdfFrame id={doc.id} title={doc.title} hasFile={doc.hasFile} />
        </div>
      )}

      {paying && (
        <div className="mt-3.5 border-t border-line-soft pt-3.5">
          <PaymentForm
            entities={entities}
            bill={{
              documentId: doc.id,
              entityId: doc.entityId,
              entityCode: doc.entityCode,
              entityIndex: doc.entityIndex,
              payee: doc.vendorName,
              amount: doc.amount,
            }}
            onCancel={() => setPaying(false)}
          />
        </div>
      )}

      {handingOff && (
        <form
          action={handOffDocument.bind(null, doc.id)}
          className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-line-soft pt-3.5"
        >
          <span className="text-[12.5px] text-muted">To</span>
          <select name="toUserId" required className={SELECT}>
            <option value="">Choose…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <span className="text-[12.5px] text-muted">to</span>
          <select name="actionKind" defaultValue="PAY" className={SELECT}>
            <option value="PAY">pay</option>
            <option value="CONFIRM">confirm</option>
            <option value="REVIEW">review</option>
          </select>
          <input
            name="note"
            placeholder="Note (optional)"
            className="min-w-32 flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12.5px] outline-none transition-colors placeholder:text-subtle focus:border-navy-500"
          />
          <button className={BTN.secondary}>Send</button>
        </form>
      )}
    </div>
  )
}

const SELECT =
  'rounded-lg border border-line bg-surface px-2 py-1.5 text-[12.5px] text-ink outline-none transition-colors focus:border-navy-500'
