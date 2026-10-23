/**
 * Sending email, and the four things that stop it going to the wrong people.
 *
 * ---------------------------------------------------------------------------
 * Why this file is mostly refusals
 * ---------------------------------------------------------------------------
 *
 * Every other mistake in this project has been recoverable. A wrong decision is undone
 * by a second one, a bad migration is reversed, a deleted row was only ever soft
 * deleted. An email is not: once it reaches somebody it cannot be taken back, and the
 * people in this database are real colleagues and the subject is their company's money.
 *
 * The local `.env` has pointed at a copy of production, and at production itself, on
 * different days of building this. A test run from a laptop could have written to
 * everybody in the company. So the guards are not a precaution bolted on; they are most
 * of what this module is.
 *
 *   1. Off unless `EMAIL_ENABLED` says otherwise. Not "on unless disabled".
 *   2. `EMAIL_TEST_TO` rewrites every recipient to one address. Every one, no exception,
 *      with the intended recipient put in the subject so a test is still legible.
 *   3. Without `EMAIL_TEST_TO`, it refuses to send at all unless the database is the
 *      production one. A copy of production holds the same real addresses; sending from
 *      a rehearsal is exactly the accident worth preventing.
 *   4. `@demo.invalid` is never written to, in any mode.
 *
 * No SDK. Resend's send endpoint is one POST, and a dependency for that is a dependency
 * to keep forever — plus the audit surface of this file is the point, so it is better
 * read in full than wrapped.
 */

import { classify, describe, resolve } from '../../scripts/db-target'

export type SendResult =
  | { ok: true; id: string | null; rewrittenTo?: string }
  | { ok: false; error: string; reason: 'disabled' | 'unsafe' | 'refused' | 'failed' }

export type Message = {
  to: string
  subject: string
  text: string
  html: string
}

function env(name: string) {
  const raw = process.env[name]
  return raw === undefined ? '' : raw.trim()
}

export function emailConfigured() {
  return env('EMAIL_ENABLED') === '1' && env('RESEND_API_KEY') !== ''
}

/**
 * What the current configuration will actually do, for a screen to show.
 *
 * Separate from sending so somebody can see the answer without causing it — "will this
 * send, and to whom" should never have to be found out by trying.
 */
export function emailMode(): {
  enabled: boolean
  hasKey: boolean
  from: string
  testTo: string | null
  /** Null when this is production, a reason when sending is restricted. */
  restriction: string | null
} {
  const testTo = env('EMAIL_TEST_TO') || null
  let restriction: string | null = null

  if (!testTo) {
    try {
      const target = describe(resolve('DATABASE_URL', 'app').value)
      const kind = target ? classify(target.host) : 'unknown'
      if (kind !== 'production') {
        restriction =
          'This is not the production database, and EMAIL_TEST_TO is not set — nothing will be sent.'
      }
    } catch {
      restriction = 'The database target could not be read, so sending is refused.'
    }
  }

  return {
    enabled: env('EMAIL_ENABLED') === '1',
    hasKey: env('RESEND_API_KEY') !== '',
    from: env('EMAIL_FROM') || 'not set',
    testTo,
    restriction,
  }
}

export async function send(message: Message): Promise<SendResult> {
  if (env('EMAIL_ENABLED') !== '1') {
    return { ok: false, error: 'EMAIL_ENABLED is not 1.', reason: 'disabled' }
  }

  const key = env('RESEND_API_KEY')
  if (!key) return { ok: false, error: 'RESEND_API_KEY is not set.', reason: 'disabled' }

  const from = env('EMAIL_FROM')
  if (!from) {
    return { ok: false, error: 'EMAIL_FROM is not set — nothing can be sent without it.', reason: 'disabled' }
  }

  // 4. Never, in any mode.
  if (message.to.toLowerCase().endsWith('@demo.invalid')) {
    return { ok: false, error: 'Demo addresses are never written to.', reason: 'refused' }
  }

  const testTo = env('EMAIL_TEST_TO')
  let to = message.to
  let subject = message.subject

  if (testTo) {
    // 2. Every recipient, no exception — and the real one is kept in sight.
    to = testTo
    subject = `[test → ${message.to}] ${message.subject}`
  } else {
    // 3. Only from production, when it is not a test.
    const mode = emailMode()
    if (mode.restriction) return { ok: false, error: mode.restriction, reason: 'unsafe' }
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text: message.text,
        html: message.html,
        // So a reply reaches a person rather than a shared address nobody watches.
        ...(env('EMAIL_REPLY_TO') ? { reply_to: env('EMAIL_REPLY_TO') } : {}),
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      return {
        ok: false,
        // Trimmed: the body can carry the address, and this string ends up in logs.
        error: `Resend refused it (${res.status}): ${body.slice(0, 200)}`,
        reason: 'failed',
      }
    }

    const body = (await res.json()) as { id?: string }
    return { ok: true, id: body.id ?? null, ...(testTo ? { rewrittenTo: testTo } : {}) }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'The send failed.',
      reason: 'failed',
    }
  }
}
