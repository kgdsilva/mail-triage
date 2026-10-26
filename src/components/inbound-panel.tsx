'use client'

import { useState, useTransition } from 'react'
import { Inbox, ShieldCheck } from 'lucide-react'
import { setInboundAddress, setInboundSenders } from '@/server/actions/inbound'
import { BTN } from '@/lib/theme'

/**
 * The forwarding address, who may use it, and what has reached it.
 *
 * The arrivals list is the point, not decoration. "I forwarded that invoice, did it
 * arrive?" is the question this feature will be asked constantly, and every other
 * possible answer is bad: searching the log finds nothing when the answer is no, and
 * silence is indistinguishable from an email that was never sent. So refusals are shown
 * next to acceptances, with the reason, in the sender's words.
 */
export type Arrival = {
  id: string
  from: string
  subject: string | null
  outcome: string
  reason: string | null
  documents: number
  at: string
}

export function InboundPanel({
  address,
  senders,
  signingConfigured,
  arrivals,
}: {
  address: string | null
  senders: string[]
  /** Whether the webhook secret is set. Without it the route refuses everything. */
  signingConfigured: boolean
  arrivals: Arrival[]
}) {
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function save(what: 'address' | 'senders', formData: FormData) {
    setError(null)
    setSaved(null)
    start(async () => {
      const res = what === 'address' ? await setInboundAddress(formData) : await setInboundSenders(formData)
      if (res.ok) setSaved(what === 'address' ? 'Address saved.' : 'Senders saved.')
      else setError(res.error)
    })
  }

  const live = Boolean(address) && signingConfigured

  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <h2 className="flex items-center gap-2 text-[15px] font-bold text-navy-900">
        <Inbox className="size-4 text-navy-500" aria-hidden />
        Forward mail in
      </h2>
      <p className="mt-1 text-[13px] text-muted">
        Forward an email and its attachments arrive in the triage queue, in the same state
        a scan does — no company, no amount, no decision. Most of what has to be paid never
        becomes paper, and downloading an attachment only to upload it again was three
        steps too many.
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-line-soft pt-3 text-[12.5px] sm:grid-cols-3">
        <Fact label="Address" value={address ?? 'not set'} warn={!address} mono />
        <Fact label="Webhook secret" value={signingConfigured ? 'set' : 'missing'} warn={!signingConfigured} />
        <Fact label="Receiving" value={live ? 'on' : 'off'} warn={!live} />
      </dl>

      {!signingConfigured && (
        <p className="mt-3 rounded-lg border border-gold-500 bg-gold-50 px-3 py-2 text-[12.5px] text-navy-900">
          <span className="font-bold">Nothing can arrive yet.</span> Without{' '}
          <span className="font-mono text-[11.5px]">RESEND_INBOUND_SECRET</span> the endpoint
          refuses every call, signed or not — an unverified door that works is worse than one
          that does not, because nobody notices.
        </p>
      )}

      <form action={(fd) => save('address', fd)} className="mt-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-subtle">
            Address mail is forwarded to
          </span>
          <input
            name="address"
            defaultValue={address ?? ''}
            placeholder="bills@inbox.example.com"
            className="w-72 rounded-lg border border-line bg-canvas px-2 py-1.5 font-mono text-[12.5px] outline-none focus:border-navy-500"
          />
        </label>
        <button disabled={pending} className={BTN.secondary}>
          Save address
        </button>
      </form>
      <p className="mt-1 text-[11.5px] text-subtle">
        Empty turns receiving off. The address decides which workspace an email belongs to, so
        two workspaces cannot share one.
      </p>

      <form action={(fd) => save('senders', fd)} className="mt-4">
        <label className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">
            <ShieldCheck className="size-3.5" aria-hidden />
            Who else may forward
          </span>
          <textarea
            name="senders"
            rows={3}
            defaultValue={senders.join('\n')}
            placeholder="bookkeeper@example.com"
            className="w-full rounded-lg border border-line bg-canvas px-2 py-1.5 font-mono text-[12px] outline-none focus:border-navy-500"
          />
        </label>
        <button disabled={pending} className={`${BTN.secondary} mt-2`}>
          Save senders
        </button>
        <p className="mt-1 text-[11.5px] text-subtle">
          One per line. Everybody with an account here may already forward, so this is only for
          people without one. There is no &ldquo;anyone&rdquo; setting on purpose: an open
          address lets a stranger put a forged invoice in a queue an approver will be asked to
          clear, which is a better attack than mailing the invoice directly.
        </p>
      </form>

      {error && <p className="mt-2 text-[12.5px] text-danger-700">{error}</p>}
      {saved && <p className="mt-2 text-[12.5px] text-ok-700">{saved}</p>}

      <div className="mt-5 border-t border-line-soft pt-3">
        <h3 className="text-[13px] font-bold text-navy-900">What has arrived</h3>
        {arrivals.length === 0 ? (
          <p className="mt-1 text-[12.5px] text-muted">
            Nothing yet. Refusals appear here too — an email dropped in silence looks exactly
            like one that was never sent, and those have opposite remedies.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-line-soft">
            {arrivals.map((a) => (
              <li key={a.id} className="py-1.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <Outcome outcome={a.outcome} />
                  <span className="font-mono text-[11.5px] text-navy-900">{a.from}</span>
                  <span className="truncate text-[12px] text-muted">{a.subject ?? '(no subject)'}</span>
                  <span className="ml-auto text-[11.5px] text-subtle">{a.at}</span>
                </div>
                {(a.reason || a.documents > 0) && (
                  <p className="text-[11.5px] text-subtle">
                    {a.documents > 0 && `${a.documents} document${a.documents === 1 ? '' : 's'}. `}
                    {a.reason}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/**
 * The word matters more than it looks.
 *
 * A duplicate was shown as "ignored" and read as a failure, because that is what
 * "ignored" means. It was the opposite: everything worked and the system declined to
 * file the same bytes twice. So it says "already here", in the tone of a thing that went
 * right, and only a genuine refusal is red.
 */
const WORDS: Record<string, { label: string; tone: string }> = {
  accepted: { label: 'filed', tone: 'bg-ok-100 text-ok-700' },
  duplicate: { label: 'already here', tone: 'bg-navy-100 text-navy-700' },
  refused: { label: 'refused', tone: 'bg-danger-100 text-danger-700' },
  ignored: { label: 'nothing to file', tone: 'bg-line-soft text-muted' },
}

function Outcome({ outcome }: { outcome: string }) {
  const word = WORDS[outcome] ?? { label: outcome, tone: 'bg-line-soft text-muted' }
  return (
    <span
      className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10.5px] font-bold uppercase ${word.tone}`}
    >
      {word.label}
    </span>
  )
}

function Fact({
  label,
  value,
  warn,
  mono,
}: {
  label: string
  value: string
  warn?: boolean
  mono?: boolean
}) {
  return (
    <div>
      <dt className="text-subtle">{label}</dt>
      <dd
        className={`${mono ? 'truncate font-mono text-[11.5px]' : 'text-[13px]'} font-semibold ${
          warn ? 'text-gold-800' : 'text-navy-900'
        }`}
      >
        {value}
      </dd>
    </div>
  )
}
