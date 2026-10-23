'use server'

import { requireAdmin } from '@/server/session'
import { sweep } from '@/server/notify-run'
import type { SweepResult } from '@/server/notify-run'

/**
 * "What would it send?" and "send mine now", from the settings screen.
 *
 * Both run the real sweep rather than a demonstration of one, because a test that
 * exercises different code tests nothing. The dry run never sends and never records,
 * which makes it safe to press at any time — including from a laptop pointed at a copy
 * of production, where sending is refused anyway.
 */

export async function previewNotifications(): Promise<SweepResult> {
  const session = await requireAdmin()
  return sweep(session.companyGroupId, { dry: true })
}

/**
 * Sends to the person pressing the button, and nobody else.
 *
 * Deliberately not "send to everybody now": a button that mails the whole company is
 * one misclick, and the schedule is what is supposed to do that. This answers the only
 * question worth answering by hand — does it arrive, and does it look right.
 */
export async function sendMyNotification(): Promise<SweepResult> {
  const session = await requireAdmin()
  return sweep(session.companyGroupId, { onlyUserId: session.userId })
}
