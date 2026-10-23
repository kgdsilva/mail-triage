import { NextResponse } from 'next/server'
import { prisma } from '@/server/db/client'
import { sweep } from '@/server/notify-run'

export const dynamic = 'force-dynamic'

/**
 * The schedule's only entry point.
 *
 * Twice a day, Vercel calls this. It runs the same sweep the settings screen runs, for
 * every workspace — so nothing about the schedule is a second implementation of
 * anything, and testing it from the screen tests this.
 *
 * ---------------------------------------------------------------------------
 * Who may call it
 * ---------------------------------------------------------------------------
 *
 * A public URL that sends email to the whole company is a URL somebody will find. Two
 * things are accepted and nothing else: Vercel's own cron header, and a secret this
 * deployment holds. Without `CRON_SECRET` set it refuses outright rather than running
 * open to the internet — an unauthenticated endpoint that works is worse than one that
 * does not, because nobody notices.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET is not set, so this refuses to run.' },
      { status: 503 },
    )
  }

  const auth = request.headers.get('authorization')
  const fromVercel = request.headers.get('x-vercel-cron') !== null
  if (!fromVercel && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Not allowed.' }, { status: 401 })
  }

  const groups = await prisma.companyGroup.findMany({ select: { id: true, name: true } })

  const runs = []
  for (const group of groups) {
    const result = await sweep(group.id)
    runs.push({ group: group.name, ...result })
  }

  // The detail carries addresses, so it is summarised rather than returned: this
  // response goes into a platform log that more people can read than can read the mail.
  return NextResponse.json({
    ok: true,
    at: new Date().toISOString(),
    runs: runs.map((r) => ({
      group: r.group,
      considered: r.considered,
      emailed: r.emailed,
      skipped: r.skipped,
      failed: r.failed,
    })),
  })
}
