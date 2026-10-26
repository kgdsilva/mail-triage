/**
 * Mail that arrives as mail.
 *
 * ---------------------------------------------------------------------------
 * The gap this closes
 * ---------------------------------------------------------------------------
 *
 * The platform was built around a scanner, and the scanner only sees paper. A growing
 * share of what has to be paid never becomes paper: the vendor emails a PDF, the agency
 * sends a notice to an inbox, the statement arrives as an attachment. For those, the
 * route into this system was absurd — open the email, download the attachment, open the
 * platform, upload the same file. Forwarding removes three of those four steps.
 *
 * It was the thing that came up most often in the meeting, and the reason is that it is
 * not a new feature at all. It is the same triage with a second door.
 *
 * ---------------------------------------------------------------------------
 * The door is on the public internet
 * ---------------------------------------------------------------------------
 *
 * This is the part worth being careful about. Every other way into this system requires
 * signing in. An address does not: anyone who learns it, or guesses it, can post a PDF
 * into the queue that an approver will later be asked to clear for payment. A forged
 * invoice in a trusted queue is a better attack than a forged invoice in an inbox.
 *
 * Four things stand between the address and the queue:
 *
 *   1. The webhook is signed, and an unsigned or mis-signed call is refused before
 *      anything is read. Without the secret set, the route refuses everything — off is
 *      the safe default for a door, not on.
 *   2. The sender must be a member of the workspace, or an address an administrator has
 *      written down. A stranger is turned away and told so, rather than dropped.
 *   3. The document lands UNREVIEWED, exactly where a scan lands. Nothing arriving by
 *      email skips triage, gets an amount, or reaches an approver without a person.
 *   4. Everything that arrives is recorded, accepted or not, because an email dropped in
 *      silence is indistinguishable from one that was never sent.
 *
 * None of those is clever. Together they mean the worst an unknown sender achieves is a
 * line in a table saying they tried.
 */

import path from 'node:path'
import { prisma } from '@/server/db/client'
import { parseIncomingFilename } from '@/server/filename-parse'
import { recordEvent } from '@/server/documents'
import { buildKey, deleteObject, putObject } from '@/server/storage'

/** What the reader can open. The same list the upload form accepts. */
const ACCEPTED = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/tiff'])

/**
 * Per attachment, not per email.
 *
 * Generous compared with the 4 MB upload cap, because nothing here passes through a
 * request body: the webhook carries only metadata and the file is fetched server-side
 * straight into storage. The limit that shaped the upload form does not apply, so the
 * only question left is what a scan of a long statement reasonably weighs.
 */
const MAX_BYTES = 25 * 1024 * 1024

export type Attachment = {
  id: string
  filename: string
  contentType: string | null
  /** Where the provider will hand over the bytes. */
  downloadUrl: string | null
  size: number | null
}

export type Arrival = {
  providerId: string
  from: string
  to: string[]
  subject: string | null
  attachments: Attachment[]
  /**
   * Set when the email had attachments this side could not get hold of.
   *
   * Kept apart from an empty list on purpose. "Nothing was attached" is the sender's
   * problem and "we could not fetch it" is ours, and the first version of this reported
   * the second as the first — telling somebody to attach the invoice they had attached.
   * A wrong diagnosis costs more than no diagnosis: it sends the only person who can
   * fix it to look in the wrong place.
   */
  fetchError?: string | null
}

export type Outcome = {
  outcome: 'accepted' | 'refused' | 'ignored'
  reason: string | null
  documentsCreated: number
}

/** Just the address, from "Name <a@b.com>" or "a@b.com". */
export function addressOf(raw: string): string {
  const angled = raw.match(/<([^>]+)>/)
  return (angled ? angled[1] : raw).trim().toLowerCase()
}

type Settings = {
  inboundAddress?: string
  inboundExtraSenders?: string[]
}

function settingsOf(value: unknown): Settings {
  return (value as Settings | null) ?? {}
}

/**
 * Which workspace an email belongs to, decided by the address it was sent to.
 *
 * Not by "the only workspace there is". That is true today and is the kind of true that
 * stops being true quietly, at which point another company's invoices would arrive in
 * this one's queue. The address is configured per workspace and has to match.
 */
export async function groupForAddress(to: string[]) {
  const wanted = to.map(addressOf)
  const groups = await prisma.companyGroup.findMany({ select: { id: true, name: true, settings: true } })

  for (const group of groups) {
    const configured = settingsOf(group.settings).inboundAddress
    if (!configured) continue
    if (wanted.includes(configured.trim().toLowerCase())) return group
  }
  return null
}

/**
 * May this person post into the queue?
 *
 * A member of the workspace, or an address an administrator has written down — a
 * bookkeeper, an assistant, a vendor who always sends to the same place. The member case
 * also gives the event an author: a document that arrived by email is attributed to
 * whoever forwarded it, which is the same information a scan carries about who uploaded
 * it.
 */
export async function senderAllowed(
  companyGroupId: string,
  from: string,
): Promise<{ allowed: boolean; userId: string | null; why: string }> {
  const address = addressOf(from)

  const membership = await prisma.membership.findFirst({
    where: { companyGroupId, isActive: true, user: { email: { equals: address, mode: 'insensitive' } } },
    select: { user: { select: { id: true } } },
  })
  if (membership) return { allowed: true, userId: membership.user.id, why: 'a member of this workspace' }

  const group = await prisma.companyGroup.findUnique({
    where: { id: companyGroupId },
    select: { settings: true },
  })
  const extra = (settingsOf(group?.settings).inboundExtraSenders ?? []).map((s) => s.trim().toLowerCase())
  if (extra.includes(address)) return { allowed: true, userId: null, why: 'an allowed sender' }

  return {
    allowed: false,
    userId: null,
    why: `${address} is not a member of this workspace and is not on the allowed-senders list.`,
  }
}

/**
 * Takes one attachment and makes it a document waiting to be triaged.
 *
 * Deliberately the same shape an upload produces: the same storage, the same filename
 * parsing for a prefilled company and date, no entity invented, no amount read, no
 * decision made. How a document got in is a line in its history, not a different kind of
 * document — which is the property that stops this becoming a second pipeline that has
 * to be kept in step with the first.
 */
async function ingest(
  companyGroupId: string,
  attachment: Attachment,
  context: { from: string; subject: string | null; actorUserId: string | null },
): Promise<{ created: boolean; reason?: string }> {
  const contentType = (attachment.contentType ?? '').toLowerCase() || 'application/pdf'
  if (!ACCEPTED.has(contentType)) {
    return { created: false, reason: `${attachment.filename}: ${contentType} is not a document the reader can open` }
  }
  if (attachment.size !== null && attachment.size > MAX_BYTES) {
    return { created: false, reason: `${attachment.filename}: over 25 MB` }
  }
  if (!attachment.downloadUrl) {
    return { created: false, reason: `${attachment.filename}: the provider gave no way to fetch it` }
  }

  const response = await fetch(attachment.downloadUrl)
  if (!response.ok) {
    return { created: false, reason: `${attachment.filename}: could not be fetched (${response.status})` }
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength === 0) return { created: false, reason: `${attachment.filename}: empty` }
  if (bytes.byteLength > MAX_BYTES) return { created: false, reason: `${attachment.filename}: over 25 MB` }

  const key = buildKey(companyGroupId, path.extname(attachment.filename) || '.pdf')
  const stored = await putObject(key, bytes, contentType)

  try {
    /*
     * The same file forwarded twice is not a second document.
     *
     * Unlike an upload, where filing one scan under two companies is a real thing
     * somebody does deliberately, a forward is nobody deciding anything — it is the same
     * email reaching two people, or one person pressing it twice. So this refuses rather
     * than creating-and-linking, and the inbound log says which document it already is.
     */
    const twin = await prisma.document.findFirst({
      where: { companyGroupId, sha256: stored.sha256, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, originalFilename: true },
    })
    if (twin) {
      await deleteObject(stored.key, stored.bucket)
      return { created: false, reason: `${attachment.filename}: already here as “${twin.originalFilename}”` }
    }

    const prefill = await parseIncomingFilename(companyGroupId, attachment.filename)

    const doc = await prisma.document.create({
      data: {
        companyGroupId,
        originalFilename: attachment.filename,
        storageKey: stored.key,
        storageBucket: stored.bucket,
        mimeType: contentType,
        byteSize: stored.byteSize,
        sha256: stored.sha256,
        entityId: prefill.entityId,
        documentDate: prefill.documentDate,
        // No disposition, no type, no amount: it lands exactly where a scan lands.
      },
    })

    await recordEvent({
      documentId: doc.id,
      actorUserId: context.actorUserId,
      action: 'arrived_by_email',
      toValue: {
        from: addressOf(context.from),
        subject: context.subject,
        originalFilename: attachment.filename,
        byteSize: stored.byteSize,
      },
    })

    return { created: true }
  } catch (err) {
    // Never leave an object in storage that no row points at.
    await deleteObject(stored.key, stored.bucket)
    throw err
  }
}

/**
 * One arriving email, start to finish, with the outcome written down either way.
 *
 * Returns rather than throws for everything a sender could have caused. A throw makes
 * the provider retry, and retrying a refusal just means being refused again on a
 * schedule — the only failures worth retrying are ours.
 */
export async function receive(arrival: Arrival): Promise<Outcome & { groupName?: string }> {
  const group = await groupForAddress(arrival.to)
  if (!group) {
    return {
      outcome: 'refused',
      reason: `No workspace is configured for ${arrival.to.map(addressOf).join(', ')}.`,
      documentsCreated: 0,
    }
  }

  const record = async (result: Outcome) => {
    await prisma.inboundEmail.upsert({
      where: { providerId: arrival.providerId },
      create: {
        companyGroupId: group.id,
        providerId: arrival.providerId,
        fromAddress: addressOf(arrival.from),
        toAddress: arrival.to.map(addressOf).join(', '),
        subject: arrival.subject,
        outcome: result.outcome,
        reason: result.reason,
        documentsCreated: result.documentsCreated,
      },
      /*
       * A replay overwrites the outcome, and that is the point of replaying.
       *
       * This was `update: {}`, meant to stop a retried webhook becoming two documents.
       * It did not do that — the sha256 check does — and it had a cost nobody would
       * guess from reading it: after fixing the cause and pressing Replay, the screen
       * went on showing the original refusal, so a fix that worked looked like a fix
       * that changed nothing. The screen lied in the one moment it was being trusted.
       */
      update: {
        outcome: result.outcome,
        reason: result.reason,
        documentsCreated: result.documentsCreated,
        receivedAt: new Date(),
      },
    })
    return { ...result, groupName: group.name }
  }

  /*
   * Already taken, so don't take it twice.
   *
   * The real guard against a retry, now stated where it belongs rather than left to the
   * sha256 check further down to catch by accident. An email that was accepted is
   * finished; replaying it should report what happened, not do it again.
   */
  const already = await prisma.inboundEmail.findUnique({
    where: { providerId: arrival.providerId },
    select: { outcome: true, reason: true, documentsCreated: true },
  })
  if (already?.outcome === 'accepted') {
    return {
      outcome: 'accepted',
      reason: already.reason,
      documentsCreated: already.documentsCreated,
      groupName: group.name,
    }
  }

  const sender = await senderAllowed(group.id, arrival.from)
  if (!sender.allowed) {
    return record({ outcome: 'refused', reason: sender.why, documentsCreated: 0 })
  }

  if (arrival.fetchError) {
    /*
     * Ours, and said as ours. Refused rather than ignored, because somebody has to act:
     * ignored reads as "there was nothing to do", and there was something to do and this
     * side failed at it.
     */
    return record({ outcome: 'refused', reason: arrival.fetchError, documentsCreated: 0 })
  }

  if (arrival.attachments.length === 0) {
    /*
     * Nothing to take. Common and not an error: a reply, a confirmation, a note. The
     * body is deliberately not turned into a document — a sentence is not a bill, and
     * filing one as if it were would put text in the queue that nobody can act on.
     */
    return record({
      outcome: 'ignored',
      reason: 'No attachment. Forward the email with the invoice attached, or attach the PDF.',
      documentsCreated: 0,
    })
  }

  let created = 0
  const skipped: string[] = []

  for (const attachment of arrival.attachments) {
    const result = await ingest(group.id, attachment, {
      from: arrival.from,
      subject: arrival.subject,
      actorUserId: sender.userId,
    })
    if (result.created) created += 1
    else if (result.reason) skipped.push(result.reason)
  }

  if (created === 0) {
    return record({
      outcome: 'ignored',
      reason: skipped.join('; ') || 'Nothing in it could be filed.',
      documentsCreated: 0,
    })
  }

  return record({
    outcome: 'accepted',
    reason: skipped.length > 0 ? `Also skipped: ${skipped.join('; ')}` : null,
    documentsCreated: created,
  })
}
