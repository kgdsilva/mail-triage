/**
 * The sweep: who is waiting on what, written as an email and sent once.
 *
 * The whole notification system is this function on a schedule. Nothing else in the app
 * sends anything, and no action has to remember to — which is the property that makes
 * this survivable: a new screen cannot forget to notify, because nothing notifies.
 */

import { emailConfigured, send } from '@/server/email'
import {
  markTold,
  notifiableMembers,
  unTold,
  waitingFor,
  type Member,
  type WaitingItem,
} from '@/server/notify'

export type SweepResult = {
  considered: number
  emailed: number
  skipped: number
  failed: number
  /** Per person, for the screen that triggered it. */
  detail: { who: string; items: number; outcome: string }[]
}

function siteUrl() {
  const raw = process.env.AUTH_URL?.trim()
  return raw ? raw.replace(/\/$/, '') : ''
}

/** "3 days overdue", "due tomorrow", or nothing at all. */
function when(dueDate: string | null): string {
  if (!dueDate) return ''
  const due = Date.parse(`${dueDate}T00:00:00Z`)
  if (Number.isNaN(due)) return ''
  const now = new Date()
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const days = Math.round((due - today) / 86_400_000)
  if (days < 0) return `${Math.abs(days)} day${days === -1 ? '' : 's'} overdue`
  if (days === 0) return 'due today'
  if (days === 1) return 'due tomorrow'
  return `due in ${days} days`
}

/**
 * The email.
 *
 * Plain, short, and honest about being a nudge: the work happens on the site, so the
 * body's job is to say whether opening it is worth doing right now. Every line is one
 * item; the count and the money are what make somebody decide.
 */
function compose(member: Member, items: WaitingItem[]) {
  const site = siteUrl()
  const overdue = items.filter((i) => when(i.dueDate).includes('overdue'))

  const subject =
    overdue.length > 0
      ? `${items.length} waiting on you — ${overdue.length} overdue`
      : `${items.length} waiting on you`

  const lines = items.map((i) => {
    const bits = [i.entityCode, i.title, i.amount, when(i.dueDate)].filter(Boolean)
    return `• ${bits.join(' · ')}\n  ${i.what}`
  })

  const text = [
    `Hello ${member.userName.split(' ')[0]},`,
    '',
    `${items.length} item${items.length === 1 ? '' : 's'} ${items.length === 1 ? 'is' : 'are'} waiting on you in ${member.companyGroupName}.`,
    '',
    ...lines,
    '',
    site ? `Open it: ${site}` : '',
    '',
    'You are getting this because something is assigned to you or waiting on your decision.',
    'It is sent twice a day at most, and only mentions each item once a week.',
  ]
    .filter((l) => l !== undefined)
    .join('\n')

  const rows = items
    .map((i) => {
      const w = when(i.dueDate)
      const late = w.includes('overdue')
      return `<tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e6e9ef">
          <div style="font:600 14px system-ui,sans-serif;color:#12284a">${escape(i.title)}</div>
          <div style="font:400 12.5px system-ui,sans-serif;color:#6b7589;margin-top:2px">${escape(i.what)}</div>
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #e6e9ef;text-align:right;white-space:nowrap">
          ${i.amount ? `<div style="font:700 14px system-ui,sans-serif;color:#12284a">${escape(i.amount)}</div>` : ''}
          ${w ? `<div style="font:600 12px system-ui,sans-serif;color:${late ? '#b4232a' : '#6b7589'};margin-top:2px">${escape(w)}</div>` : ''}
        </td>
      </tr>`
    })
    .join('')

  const html = `<div style="background:#f3f5f9;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e6e9ef;border-radius:12px;overflow:hidden">
    <div style="padding:18px 20px;border-bottom:1px solid #e6e9ef">
      <div style="font:800 17px system-ui,sans-serif;color:#12284a">${items.length} waiting on you</div>
      <div style="font:400 13px system-ui,sans-serif;color:#6b7589;margin-top:3px">${escape(member.companyGroupName)}</div>
    </div>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
    ${
      site
        ? `<div style="padding:18px 20px">
             <a href="${escape(site)}" style="display:inline-block;background:#12284a;color:#fff;font:600 14px system-ui,sans-serif;text-decoration:none;padding:10px 18px;border-radius:8px">Open Mail Triage</a>
           </div>`
        : ''
    }
    <div style="padding:0 20px 18px;font:400 11.5px system-ui,sans-serif;color:#9099ab">
      Sent because something is assigned to you or waiting on your decision. Twice a day at most, and each item is mentioned once a week.
    </div>
  </div>
</div>`

  return { subject, text, html }
}

function escape(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

/**
 * Runs the sweep for a whole group.
 *
 * `onlyUserId` restricts it to one person, which is how the "send mine now" button on
 * the settings screen works — the same code path as the schedule, so testing it tests
 * the real thing rather than a demonstration of it.
 */
export async function sweep(
  companyGroupId: string,
  opts: { onlyUserId?: string; dry?: boolean } = {},
): Promise<SweepResult> {
  const result: SweepResult = { considered: 0, emailed: 0, skipped: 0, failed: 0, detail: [] }

  if (!opts.dry && !emailConfigured()) {
    return {
      ...result,
      detail: [{ who: '—', items: 0, outcome: 'Email is switched off (EMAIL_ENABLED / RESEND_API_KEY).' }],
    }
  }

  const members = await notifiableMembers(companyGroupId)
  for (const member of members) {
    if (opts.onlyUserId && member.userId !== opts.onlyUserId) continue
    result.considered += 1

    const waiting = await waitingFor(member)
    const fresh = await unTold(member, waiting)

    if (fresh.length === 0) {
      result.skipped += 1
      result.detail.push({
        who: member.userEmail,
        items: 0,
        outcome: waiting.length === 0 ? 'nothing waiting' : 'already told about all of it',
      })
      continue
    }

    if (opts.dry) {
      result.detail.push({ who: member.userEmail, items: fresh.length, outcome: 'would send' })
      continue
    }

    const { subject, text, html } = compose(member, fresh)
    const sent = await send({ to: member.userEmail, subject, text, html })

    if (sent.ok) {
      // Recorded only on success: a send that failed has told nobody, and marking it
      // would silence the next sweep about the very items nobody heard of.
      await markTold(member, fresh, { markShared: !opts.onlyUserId })
      result.emailed += 1
      result.detail.push({
        who: member.userEmail,
        items: fresh.length,
        outcome: sent.rewrittenTo ? `sent (rewritten to ${sent.rewrittenTo})` : 'sent',
      })
    } else {
      result.failed += 1
      result.detail.push({ who: member.userEmail, items: fresh.length, outcome: sent.error })
    }
  }

  return result
}
