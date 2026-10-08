import 'dotenv/config'
import { requireSafeTarget } from '../scripts/db-target'
import { prisma } from '../src/server/db/client'

/**
 * Takes the demo out again, completely.
 *
 * One command, because demo data that needs a careful hand to remove is demo data that
 * stays in the database for a year and eventually gets counted in somebody's total.
 *
 * Everything it deletes it can identify without judgement: documents carry `isDemo`, the
 * accounts use a reserved domain that cannot receive mail, and the vendors are the ones
 * named by the seed. Nothing is matched on "looks like a test".
 *
 * `app.purge_demo` is the one thing that can get past the append-only trigger on
 * document_event, set for this transaction only. It exists because the demo has to be
 * able to withdraw its own history; it is in this file, in the repository, rather than
 * being a capability anybody has by accident.
 *
 * **It never touches object storage.** The demo creates documents with no file attached,
 * so there is nothing of its own in R2 — and a purge that went looking would be a purge
 * that could delete a real invoice. The one safe amount of bucket access here is none.
 */

const DEMO_DOMAIN = '@demo.invalid'

const DEMO_VENDORS = [
  'Umbrella Cloudworks',
  'Pinewood Legal LLP',
  'Beacon Office Supply',
  'Harborlight Utilities',
  'Northwind Insurance Co',
  'Stagecoach Marketing',
  'Copperline Hosting',
  'Granite Peak Advisors',
  'Tidewater Facilities',
  'Brightpath Media',
  'Ironvale Telecom',
  'Mallard & Finch Supply',
]

async function main() {
  // Called here as well as from the npm script: running this file directly with tsx
  // must not be a way around the check.
  requireSafeTarget('delete all demo data')

  const docs = await prisma.document.findMany({ where: { isDemo: true }, select: { id: true } })
  const ids = docs.map((d) => d.id)

  /*
   * Everything is scoped to the group the demo seeded into.
   *
   * It was not, and that is a real difference when this runs against a copy of
   * production: deleting a batch or a vendor *by name alone* reaches into every
   * workspace, and the personal workspace is explicitly none of this feature's
   * business. The names are deliberately absurd, so a collision is unlikely — but
   * "unlikely" is not the standard for a delete.
   */
  const group = await prisma.companyGroup.findFirst({ where: { slug: 'colab' } })
  if (!group) throw new Error('No "colab" company group — nothing could have been seeded.')

  const demoUsers = await prisma.user.findMany({
    where: { email: { endsWith: DEMO_DOMAIN } },
    select: { id: true, email: true },
  })

  /*
   * A demo account that did something to real data is kept, not deleted.
   *
   * `Payment.recordedByUserId` is required, so deleting the account that recorded one
   * would either fail the whole purge on a foreign key or — if it were cascaded — take a
   * real payment record with it. Both are worse than leaving one deactivated account
   * behind, which is why this reports instead of choosing.
   *
   * It is a live possibility, not a hypothetical: the walkthrough has Chris marking a
   * bill as paid, and if he picks a real one rather than a demo one, this is the row
   * that exists afterwards.
   */
  const entangled = await prisma.payment.findMany({
    where: {
      recordedByUserId: { in: demoUsers.map((u) => u.id) },
      OR: [{ document: { isDemo: false } }, { documentId: null }],
    },
    select: { id: true, recordedByUserId: true, document: { select: { finalFilename: true } } },
  })
  const keepUserIds = new Set(entangled.map((p) => p.recordedByUserId))

  const removed = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT set_config('app.purge_demo', 'on', true)")

    const payments = await tx.payment.deleteMany({ where: { documentId: { in: ids } } })
    const links = await tx.documentLink.deleteMany({
      where: { OR: [{ fromDocumentId: { in: ids } }, { toDocumentId: { in: ids } }] },
    })
    const events = await tx.documentEvent.deleteMany({ where: { documentId: { in: ids } } })
    const documents = await tx.document.deleteMany({ where: { id: { in: ids } } })

    const batches = await tx.batch.deleteMany({
      where: { companyGroupId: group.id, label: 'Demo bills' },
    })

    // And only a demo vendor nothing else refers to: a name collision with a real
    // supplier would otherwise take its autopay rule and its history with it.
    const vendors = await tx.vendor.deleteMany({
      where: {
        companyGroupId: group.id,
        name: { in: DEMO_VENDORS },
        documents: { none: {} },
        autopayRules: { none: {} },
        payments: { none: {} },
      },
    })

    const removable = demoUsers.filter((u) => !keepUserIds.has(u.id)).map((u) => u.id)
    await tx.membership.deleteMany({ where: { userId: { in: removable } } })
    await tx.user.deleteMany({ where: { id: { in: removable } } })

    // Kept but locked out, so a demo account cannot be signed into after the demo.
    const kept = demoUsers.filter((u) => keepUserIds.has(u.id)).map((u) => u.id)
    if (kept.length > 0) {
      await tx.membership.updateMany({ where: { userId: { in: kept } }, data: { isActive: false } })
      await tx.user.updateMany({
        where: { id: { in: kept } },
        data: { passwordHash: null, pendingPassword: null, pendingPasswordSetAt: null },
      })
    }

    return {
      documents: documents.count,
      events: events.count,
      payments: payments.count,
      links: links.count,
      batches: batches.count,
      vendors: vendors.count,
      accountsRemoved: removable.length,
      accountsKept: kept.length,
    }
  })

  console.log('Demo removed:', removed)
  console.log('Object storage: untouched — the demo attaches no files, so it owns none.')

  if (entangled.length > 0) {
    console.log('')
    console.log(`  ${entangled.length} payment(s) recorded by a demo account against real`)
    console.log('  documents, so those accounts were deactivated rather than deleted:')
    for (const p of entangled) {
      console.log(`    - ${p.document?.finalFilename ?? '(no document)'}`)
    }
    console.log('  Review those payments and remove the accounts by hand once resolved.')
  }

  const left = await prisma.document.count({ where: { isDemo: true } })
  console.log(left === 0 ? 'No demo rows remain.' : `WARNING: ${left} demo rows remain.`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
