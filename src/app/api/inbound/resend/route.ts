import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { receive, type Attachment } from '@/server/inbound'

export const dynamic = 'force-dynamic'

/**
 * Where forwarded mail arrives.
 *
 * Everything provider-shaped lives here and nothing else does: the signature scheme, the
 * payload field names, the second call that turns attachment metadata into bytes. What
 * an arriving email *means* is in src/server/inbound.ts, so swapping providers is this
 * file and not the feature.
 *
 * ---------------------------------------------------------------------------
 * Why the second call
 * ---------------------------------------------------------------------------
 *
 * The webhook deliberately carries no file content — only an `email_id` and a list of
 * attachment names. The bytes are fetched afterwards from the Attachments API, which is
 * what makes this work at all on Vercel: a request body is capped at 4.5 MB and a scanned
 * statement is not. Nothing large ever passes through this endpoint; it is told that
 * something arrived and goes to get it.
 */

const RESEND_API = 'https://api.resend.com'

/** Five minutes. A signed call older than that is a replay, not a slow network. */
const TOLERANCE_SECONDS = 300

type Verified =
  | { ok: true }
  | { ok: false; status: number; error: string }

/**
 * Checks the signature, by hand.
 *
 * No SDK, for the same reason the sending side has none: this is one HMAC, and the
 * audit surface of the only thing standing between a public URL and the payment queue is
 * better read in full than imported.
 *
 * The scheme is Svix's, which Resend uses. The signed content is the delivery id, the
 * timestamp and the exact raw body joined by dots — exact meaning the bytes as received,
 * which is why this route reads text and parses afterwards. Re-serialising the parsed
 * JSON would change a space somewhere and fail every signature forever.
 */
function verify(headers: Headers, rawBody: string): Verified {
  const secret = process.env.RESEND_INBOUND_SECRET?.trim()
  if (!secret) {
    /*
     * Off is the safe default for a door. An unverified endpoint that works is worse
     * than one that does not, because nobody notices the first kind.
     */
    return { ok: false, status: 503, error: 'RESEND_INBOUND_SECRET is not set, so this refuses to run.' }
  }

  const id = headers.get('svix-id')
  const timestamp = headers.get('svix-timestamp')
  const signature = headers.get('svix-signature')
  if (!id || !timestamp || !signature) {
    return { ok: false, status: 401, error: 'Not signed.' }
  }

  const sent = Number(timestamp)
  if (!Number.isFinite(sent) || Math.abs(Date.now() / 1000 - sent) > TOLERANCE_SECONDS) {
    return { ok: false, status: 401, error: 'Signature timestamp is outside the accepted window.' }
  }

  // `whsec_` prefixes a base64 secret; some dashboards show it without the prefix.
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest()

  // Any of them: Svix sends several during a secret rotation.
  const offered = signature.split(' ').flatMap((part) => {
    const [version, value] = part.split(',')
    return version === 'v1' && value ? [value] : []
  })

  for (const candidate of offered) {
    const bytes = Buffer.from(candidate, 'base64')
    if (bytes.length === expected.length && timingSafeEqual(bytes, expected)) return { ok: true }
  }

  return { ok: false, status: 401, error: 'Signature does not match.' }
}

type WebhookAttachment = {
  id?: string
  filename?: string
  content_type?: string
  content_disposition?: string
  content_id?: string
}

type Payload = {
  type?: string
  data?: {
    email_id?: string
    from?: string
    to?: string[]
    subject?: string
    attachments?: WebhookAttachment[]
  }
}

/**
 * An email signature's logo is an attachment too.
 *
 * `inline` attachments are the images the mail client embedded in the body — a company
 * logo, a social icon, a tracking pixel. Without this, every forwarded email would file
 * the sender's letterhead as a document for somebody to triage, and the queue would fill
 * with other companies' branding.
 */
function isRealAttachment(a: { contentDisposition: string | null; contentId: string | null }) {
  if (a.contentDisposition && a.contentDisposition.toLowerCase() === 'inline') return false
  if (a.contentId) return false
  return true
}

/** The bytes live behind a second call; this is it. */
async function fetchAttachments(emailId: string): Promise<Attachment[]> {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) return []

  const res = await fetch(`${RESEND_API}/emails/receiving/${emailId}/attachments`, {
    headers: { Authorization: `Bearer ${key}` },
  })
  if (!res.ok) return []

  const body = (await res.json()) as {
    data?: {
      id?: string
      filename?: string
      size?: number
      content_type?: string
      content_disposition?: string
      content_id?: string
      download_url?: string
    }[]
  }

  return (body.data ?? [])
    .map((a) => ({
      id: a.id ?? '',
      filename: a.filename ?? 'attachment',
      contentType: a.content_type ?? null,
      contentDisposition: a.content_disposition ?? null,
      contentId: a.content_id ?? null,
      downloadUrl: a.download_url ?? null,
      size: typeof a.size === 'number' ? a.size : null,
    }))
    .filter(isRealAttachment)
    .map(({ contentDisposition: _d, contentId: _c, ...rest }) => rest)
}

export async function POST(request: Request) {
  const rawBody = await request.text()

  const verified = verify(request.headers, rawBody)
  if (!verified.ok) {
    return NextResponse.json({ ok: false, error: verified.error }, { status: verified.status })
  }

  let payload: Payload
  try {
    payload = JSON.parse(rawBody) as Payload
  } catch {
    return NextResponse.json({ ok: false, error: 'Body is not JSON.' }, { status: 400 })
  }

  // Resend sends other events to the same endpoint if it is configured for them.
  if (payload.type !== 'email.received') {
    return NextResponse.json({ ok: true, ignored: payload.type ?? 'unknown' })
  }

  const data = payload.data ?? {}
  if (!data.email_id || !data.from || !data.to?.length) {
    return NextResponse.json({ ok: false, error: 'Missing email_id, from or to.' }, { status: 400 })
  }

  /*
   * 200 even on a refusal, on purpose.
   *
   * A non-2xx makes the provider retry, and retrying a stranger's refused email just
   * means refusing it again on a schedule. The only failures worth a retry are ours —
   * storage down, database unreachable — and those throw, which Next answers with a 500
   * and the provider does retry. The unique provider_id is what makes that retry safe.
   */
  const outcome = await receive({
    providerId: data.email_id,
    from: data.from,
    to: data.to,
    subject: data.subject ?? null,
    attachments: await fetchAttachments(data.email_id),
  })

  return NextResponse.json({
    ok: true,
    outcome: outcome.outcome,
    documents: outcome.documentsCreated,
    // No addresses and no subject: this response lands in a platform log that more
    // people can read than can read the mail itself.
    reason: outcome.outcome === 'accepted' ? null : outcome.reason,
  })
}
