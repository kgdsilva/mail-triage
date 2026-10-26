'use server'

import { revalidatePath } from 'next/cache'
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/server/db/client'
import { addressOf } from '@/server/inbound'
import { requireAdmin } from '@/server/session'

export type Saved = { ok: true } | { ok: false; error: string }

async function patchSettings(companyGroupId: string, patch: Record<string, unknown>) {
  const group = await prisma.companyGroup.findUniqueOrThrow({
    where: { id: companyGroupId },
    select: { settings: true },
  })
  await prisma.companyGroup.update({
    where: { id: companyGroupId },
    data: {
      settings: {
        ...((group.settings as Record<string, unknown> | null) ?? {}),
        ...patch,
      } as Prisma.InputJsonValue,
    },
  })
}

/**
 * The address this workspace receives forwarded mail at.
 *
 * Stored rather than read from an environment variable, because it decides *which*
 * workspace an arriving email belongs to. An address in the environment would mean one
 * deployment can only ever serve one workspace's inbox, and the day a second one existed
 * the first one's invoices would arrive in it.
 *
 * Empty turns receiving off: no address configured means no email matches, which the
 * route records as refused rather than guessing.
 */
export async function setInboundAddress(formData: FormData): Promise<Saved> {
  try {
    const session = await requireAdmin()
    const raw = String(formData.get('address') ?? '').trim().toLowerCase()

    if (raw !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw)) {
      return { ok: false, error: 'That is not an email address.' }
    }

    /*
     * Two workspaces cannot share an address. Whoever configured it second would
     * otherwise silently take delivery of the first one's mail — the match is by
     * address, and the query stops at the first one it finds.
     */
    if (raw !== '') {
      const groups = await prisma.companyGroup.findMany({
        where: { id: { not: session.companyGroupId } },
        select: { name: true, settings: true },
      })
      const clash = groups.find(
        (g) =>
          String((g.settings as { inboundAddress?: string } | null)?.inboundAddress ?? '')
            .trim()
            .toLowerCase() === raw,
      )
      if (clash) {
        return { ok: false, error: `${raw} is already receiving mail for ${clash.name}.` }
      }
    }

    await patchSettings(session.companyGroupId, { inboundAddress: raw || null })
    revalidatePath('/settings/workflow')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'That could not be saved.' }
  }
}

/**
 * Addresses allowed to forward, beyond the workspace's own members.
 *
 * Members are allowed automatically — they already have an account and can upload by
 * hand anyway, so requiring them to be listed twice would only produce a list somebody
 * forgets to update. This is for everyone else: a bookkeeper, an assistant, a vendor who
 * always sends to the same place.
 *
 * It is a list and not a switch for "anyone", and there is deliberately no such switch.
 * An open address lets a stranger put a forged invoice in a queue an approver will later
 * be asked to clear, which is a better attack than mailing the forged invoice directly.
 */
export async function setInboundSenders(formData: FormData): Promise<Saved> {
  try {
    const session = await requireAdmin()

    const addresses = String(formData.get('senders') ?? '')
      .split(/[\n,;]+/)
      .map((s) => addressOf(s))
      .filter(Boolean)

    const bad = addresses.filter((a) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a))
    if (bad.length > 0) {
      return { ok: false, error: `Not an email address: ${bad.slice(0, 3).join(', ')}` }
    }

    await patchSettings(session.companyGroupId, {
      inboundExtraSenders: [...new Set(addresses)],
    })
    revalidatePath('/settings/workflow')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'That could not be saved.' }
  }
}
