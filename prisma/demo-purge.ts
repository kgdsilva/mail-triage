import 'dotenv/config'
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
  const docs = await prisma.document.findMany({ where: { isDemo: true }, select: { id: true } })
  const ids = docs.map((d) => d.id)

  const removed = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT set_config('app.purge_demo', 'on', true)")

    const payments = await tx.payment.deleteMany({ where: { documentId: { in: ids } } })
    const links = await tx.documentLink.deleteMany({
      where: { OR: [{ fromDocumentId: { in: ids } }, { toDocumentId: { in: ids } }] },
    })
    const events = await tx.documentEvent.deleteMany({ where: { documentId: { in: ids } } })
    const documents = await tx.document.deleteMany({ where: { id: { in: ids } } })

    const batches = await tx.batch.deleteMany({ where: { label: 'Demo bills' } })
    const vendors = await tx.vendor.deleteMany({ where: { name: { in: DEMO_VENDORS } } })

    const users = await tx.user.findMany({
      where: { email: { endsWith: DEMO_DOMAIN } },
      select: { id: true },
    })
    await tx.membership.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } })
    await tx.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } })

    return {
      documents: documents.count,
      events: events.count,
      payments: payments.count,
      links: links.count,
      batches: batches.count,
      vendors: vendors.count,
      accounts: users.length,
    }
  })

  console.log('Demo removed:', removed)

  const left = await prisma.document.count({ where: { isDemo: true } })
  console.log(left === 0 ? 'No demo rows remain.' : `WARNING: ${left} demo rows remain.`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
