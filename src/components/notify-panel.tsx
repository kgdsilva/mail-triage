'use client'

import { useState, useTransition } from 'react'
import { Mail, Send, Eye } from 'lucide-react'
import { previewNotifications, sendMyNotification } from '@/server/actions/notify'
import type { SweepResult } from '@/server/notify-run'
import { BTN } from '@/lib/theme'

/**
 * What the email system will do, and the one button that proves it.
 *
 * The state is shown rather than described: every deployment of this has a different
 * answer to "will it send, and to whom", and finding that out by waiting for 1pm and
 * then asking somebody whether they got anything is not a test.
 */
export function NotifyPanel({
  enabled,
  hasKey,
  from,
  testTo,
  restriction,
}: {
  enabled: boolean
  hasKey: boolean
  from: string
  testTo: string | null
  restriction: string | null
}) {
  const [pending, start] = useTransition()
  const [result, setResult] = useState<SweepResult | null>(null)
  const [what, setWhat] = useState<'preview' | 'send' | null>(null)

  const live = enabled && hasKey && !restriction

  function run(kind: 'preview' | 'send') {
    setWhat(kind)
    setResult(null)
    start(async () => {
      setResult(kind === 'preview' ? await previewNotifications() : await sendMyNotification())
    })
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <h2 className="flex items-center gap-2 text-[15px] font-bold text-navy-900">
        <Mail className="size-4 text-navy-500" aria-hidden />
        Email reminders
      </h2>
      <p className="mt-1 text-[13px] text-muted">
        Twice a day on weekdays, anybody with something waiting gets one email listing it.
        Nothing is sent when an item appears — thirty uploads would be thirty emails — and each
        item is mentioned at most once a week, so silence means nothing new.
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-line-soft pt-3 text-[12.5px] sm:grid-cols-4">
        <Fact label="Switch" value={enabled ? 'on' : 'off'} warn={!enabled} />
        <Fact label="Resend key" value={hasKey ? 'set' : 'missing'} warn={!hasKey} />
        <Fact label="From" value={from} warn={from === 'not set'} mono />
        <Fact
          label="Recipients"
          value={testTo ? `all rewritten to ${testTo}` : 'the real people'}
          warn={Boolean(testTo)}
        />
      </dl>

      {restriction && (
        <p className="mt-3 rounded-lg border border-gold-500 bg-gold-50 px-3 py-2 text-[12.5px] text-navy-900">
          <span className="font-bold">Sending is blocked here.</span> {restriction}
        </p>
      )}

      {live && !testTo && (
        <p className="mt-3 rounded-lg border border-danger-500 bg-danger-100 px-3 py-2 text-[12.5px] text-danger-700">
          <span className="font-bold">This will write to real people.</span> The switch is on, the
          key is set, and recipients are not being rewritten.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={BTN.secondary} disabled={pending} onClick={() => run('preview')}>
          <Eye className="size-3.5" aria-hidden />
          {pending && what === 'preview' ? 'Checking…' : 'What would it send?'}
        </button>
        <button type="button" className={BTN.primary} disabled={pending} onClick={() => run('send')}>
          <Send className="size-3.5" aria-hidden />
          {pending && what === 'send' ? 'Sending…' : 'Send mine now'}
        </button>
      </div>
      <p className="mt-1.5 text-[11.5px] text-subtle">
        The preview sends nothing and records nothing. &ldquo;Send mine now&rdquo; writes to you
        only — there is deliberately no button that mails everybody, because that is the
        schedule&rsquo;s job and one misclick is too cheap.
      </p>

      {result && (
        <div className="mt-3 rounded-lg border border-line bg-canvas p-3">
          <p className="text-[12.5px] font-semibold text-navy-900">
            {what === 'preview'
              ? `${result.considered} people checked · ${result.detail.filter((d) => d.outcome === 'would send').length} would get an email`
              : `${result.emailed} sent · ${result.failed} failed · ${result.skipped} skipped`}
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {result.detail.map((d) => (
              <li key={d.who + d.outcome} className="text-[12px] text-muted">
                <span className="font-medium text-navy-900">{d.who}</span> —{' '}
                {d.items > 0 ? `${d.items} item${d.items === 1 ? '' : 's'}, ` : ''}
                {d.outcome}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
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
        className={`${mono ? 'font-mono text-[11.5px]' : 'text-[13px]'} font-semibold ${
          warn ? 'text-gold-800' : 'text-navy-900'
        }`}
      >
        {value}
      </dd>
    </div>
  )
}
