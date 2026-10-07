import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import { prisma } from '../src/server/db/client'
import { hashPassword } from '../src/server/password'

/**
 * Twelve obviously-fake bills, for walking the accountant through the workflow.
 *
 * Flagged rather than kept in a separate database, so the demo exercises the code the
 * real work runs on — a walkthrough on a parallel implementation proves nothing. Every
 * row this writes carries `isDemo`, every vendor is named so nobody could mistake it for
 * a real supplier, and `npm run demo:purge` takes all of it out again.
 *
 *   npm run demo:seed     adds or refreshes the demo
 *   npm run demo:purge    removes every trace of it
 */

const DEMO_DOMAIN = '@demo.invalid'

type Person = {
  email: string
  name: string
  role: 'APPROVER' | 'ACCOUNTANT'
  /** Entity codes they approve. Empty for the accountant, who sees all but the separate. */
  codes: string[]
}

/** A reserved address makes the demo accounts unmistakable, and un-emailable. */
const PEOPLE: Person[] = [
  { email: `eric${DEMO_DOMAIN}`, name: 'Eric Demo', role: 'APPROVER', codes: ['CCS', 'MMT', 'CP'] },
  { email: `danny${DEMO_DOMAIN}`, name: 'Danny Demo', role: 'APPROVER', codes: ['MM'] },
  { email: `chris${DEMO_DOMAIN}`, name: 'Chris Demo', role: 'ACCOUNTANT', codes: [] },
]

type Spec = {
  vendor: string
  invoice: string
  amount: string
  code: string
  category: string
  /** Days from today; negative is in the past. */
  due: number
  received: number
  status: 'PENDING' | 'APPROVED' | 'DENIED' | 'NEEDS_REVIEW'
  note?: string
  paid?: boolean
}

/*
 * Chosen to cover what the demo has to show rather than to look plentiful: one overdue,
 * one due inside three days, one denied with its note, one sent back with a question,
 * one already paid, and several plain pending ones across four companies so the entity
 * scoping is visible — Danny's single MM bill next to Eric's three companies.
 */
const BILLS: Spec[] = [
  { vendor: 'Umbrella Cloudworks', invoice: 'UC-10231', amount: '1240.00', code: 'CP', category: 'Technology', due: -6, received: -20, status: 'PENDING' },
  { vendor: 'Pinewood Legal LLP', invoice: 'PL-0442', amount: '3800.00', code: 'CP', category: 'Legal', due: 2, received: -9, status: 'PENDING' },
  { vendor: 'Beacon Office Supply', invoice: 'BOS-77119', amount: '212.45', code: 'CCS', category: 'Office/Rent', due: 11, received: -4, status: 'PENDING' },
  { vendor: 'Harborlight Utilities', invoice: 'HU-558120', amount: '486.90', code: 'MMT', category: 'Utilities', due: 1, received: -7, status: 'PENDING' },
  { vendor: 'Northwind Insurance Co', invoice: 'NW-2026-884', amount: '2975.00', code: 'MM', category: 'Insurance', due: 14, received: -3, status: 'PENDING' },
  { vendor: 'Stagecoach Marketing', invoice: 'SM-6610', amount: '1500.00', code: 'MM', category: 'Marketing', due: -2, received: -16, status: 'PENDING' },
  { vendor: 'Copperline Hosting', invoice: 'CH-4417', amount: '89.00', code: 'CP', category: 'Technology', due: 20, received: -2, status: 'APPROVED' },
  { vendor: 'Granite Peak Advisors', invoice: 'GPA-331', amount: '5400.00', code: 'CCS', category: 'Legal', due: 8, received: -6, status: 'APPROVED' },
  { vendor: 'Tidewater Facilities', invoice: 'TF-9087', amount: '760.00', code: 'MMT', category: 'Office/Rent', due: 5, received: -5, status: 'APPROVED' },
  {
    vendor: 'Brightpath Media',
    invoice: 'BM-2211',
    amount: '990.00',
    code: 'CP',
    category: 'Marketing',
    due: 9,
    received: -11,
    status: 'DENIED',
    note: 'Duplicate of BM-2187, already paid in September.',
  },
  {
    vendor: 'Ironvale Telecom',
    invoice: 'IT-70044',
    amount: '318.20',
    code: 'CCS',
    category: 'Utilities',
    due: 4,
    received: -8,
    status: 'NEEDS_REVIEW',
    note: 'Is this the Concierge line or Processing? The address looks wrong.',
  },
  { vendor: 'Mallard & Finch Supply', invoice: 'MF-1203', amount: '430.75', code: 'MM', category: 'Office/Rent', due: -12, received: -30, status: 'APPROVED', paid: true },
]

function dayFromNow(days: number) {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

async function main() {
  const group = await prisma.companyGroup.findFirst({ where: { slug: 'colab' } })
  if (!group) throw new Error('No "colab" company group — run the normal seed first.')

  const entities = await prisma.entity.findMany({
    where: { companyGroupId: group.id },
    select: { id: true, code: true },
  })
  const byCode = new Map(entities.map((e) => [e.code, e.id]))

  const categories = await prisma.category.findMany({
    where: { companyGroupId: group.id },
    select: { id: true, name: true },
  })
  const categoryByName = new Map(categories.map((c) => [c.name, c.id]))

  const billType = await prisma.documentType.findFirst({
    where: { companyGroupId: group.id, code: 'BILL' },
    select: { id: true },
  })

  const owner = await prisma.membership.findFirst({
    where: { companyGroupId: group.id, role: 'OWNER', isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { userId: true },
  })
  if (!owner) throw new Error('The group has no owner to attribute the demo history to.')

  /*
   * --- the people ------------------------------------------------------------
   *
   * One password, fresh each run, printed once and shared by all three accounts: the
   * demo needs somebody to be able to sign in as each role, and a walkthrough where the
   * presenter cannot log in as the accountant is not a walkthrough. It is random rather
   * than a memorable constant so it never becomes a password that works somewhere real,
   * and the accounts live on a domain that cannot receive mail.
   */
  const password = `demo-${randomBytes(6).toString('hex')}`
  const passwordHash = await hashPassword(password)

  const userByEmail = new Map<string, string>()
  for (const person of PEOPLE) {
    const user = await prisma.user.upsert({
      where: { email: person.email },
      create: { email: person.email, name: person.name, passwordHash },
      update: { name: person.name, passwordHash },
    })
    userByEmail.set(person.email, user.id)

    await prisma.membership.upsert({
      where: { userId_companyGroupId: { userId: user.id, companyGroupId: group.id } },
      create: {
        userId: user.id,
        companyGroupId: group.id,
        role: person.role,
        entityScope: person.codes.map((c) => byCode.get(c)!).filter(Boolean),
      },
      update: {
        role: person.role,
        isActive: true,
        entityScope: person.codes.map((c) => byCode.get(c)!).filter(Boolean),
      },
    })
  }

  const batch = await prisma.batch.upsert({
    where: { id: (await demoBatchId(group.id)) ?? 'create-me' },
    create: {
      companyGroupId: group.id,
      label: 'Demo bills',
      source: 'MANUAL_UPLOAD',
      uploadedByUserId: owner.userId,
    },
    update: {},
    select: { id: true },
  })

  // --- the bills -------------------------------------------------------------
  let made = 0
  for (const spec of BILLS) {
    const entityId = byCode.get(spec.code)
    if (!entityId) continue

    const vendor = await prisma.vendor.upsert({
      where: { companyGroupId_name: { companyGroupId: group.id, name: spec.vendor } },
      create: { companyGroupId: group.id, name: spec.vendor, notes: 'Demo vendor.' },
      update: {},
      select: { id: true },
    })

    const filename = `${spec.code}_${spec.invoice}_${spec.vendor.replace(/\s+/g, '')}.pdf`
    const existing = await prisma.document.findFirst({
      where: { companyGroupId: group.id, isDemo: true, invoiceNumber: spec.invoice },
      select: { id: true },
    })

    const decider = spec.status === 'PENDING' ? null : approverFor(spec.code, userByEmail)

    const data = {
      companyGroupId: group.id,
      batchId: batch.id,
      isDemo: true,
      originalFilename: filename,
      finalFilename: filename.replace(/\.pdf$/, ''),
      entityId,
      documentTypeId: billType?.id ?? null,
      categoryId: categoryByName.get(spec.category) ?? null,
      vendorId: vendor.id,
      invoiceNumber: spec.invoice,
      amount: spec.amount,
      documentDate: dayFromNow(spec.received),
      dueDate: dayFromNow(spec.due),
      disposition: 'ACTION' as const,
      actionKind: 'PAY' as const,
      status: spec.paid ? ('DONE' as const) : ('WAITING' as const),
      approvalStatus: spec.status,
      approvalNote: spec.note ?? null,
      approvalDecidedByUserId: decider,
      approvalDecidedAt: spec.status === 'PENDING' ? null : dayFromNow(spec.received + 1),
      summaryNote: `Demo bill from ${spec.vendor}.`,
      createdAt: dayFromNow(spec.received),
      reviewedByUserId: owner.userId,
      reviewedAt: dayFromNow(spec.received),
    }

    const doc = existing
      ? await prisma.document.update({ where: { id: existing.id }, data, select: { id: true } })
      : await prisma.document.create({ data, select: { id: true } })

    // History, so the demo can open the audit panel and find something in it.
    const already = await prisma.documentEvent.count({ where: { documentId: doc.id } })
    if (already === 0) {
      await prisma.documentEvent.create({
        data: {
          documentId: doc.id,
          actorUserId: owner.userId,
          action: 'uploaded',
          toValue: { originalFilename: filename, demo: true },
          createdAt: dayFromNow(spec.received),
        },
      })
      await prisma.documentEvent.create({
        data: {
          documentId: doc.id,
          actorUserId: owner.userId,
          action: 'classified',
          toValue: { disposition: 'ACTION', actionKind: 'PAY', approvalStatus: 'PENDING' },
          createdAt: dayFromNow(spec.received),
        },
      })
      if (spec.status !== 'PENDING' && decider) {
        await prisma.documentEvent.create({
          data: {
            documentId: doc.id,
            actorUserId: decider,
            action:
              spec.status === 'APPROVED'
                ? 'approved'
                : spec.status === 'DENIED'
                  ? 'denied'
                  : 'needs_review',
            toValue: { approvalStatus: spec.status, note: spec.note ?? null },
            createdAt: dayFromNow(spec.received + 1),
          },
        })
      }
    }

    if (spec.paid) {
      const paid = await prisma.payment.findFirst({ where: { documentId: doc.id } })
      if (!paid) {
        await prisma.payment.create({
          data: {
            companyGroupId: group.id,
            documentId: doc.id,
            entityId,
            vendorId: vendor.id,
            amount: spec.amount,
            paidOn: dayFromNow(spec.due),
            method: 'Check',
            reference: '10442',
            note: 'Demo payment.',
            recordedByUserId: userByEmail.get(`chris${DEMO_DOMAIN}`) ?? owner.userId,
          },
        })
      }
    }

    made += 1
  }

  console.log(`Demo ready: ${made} bills, ${PEOPLE.length} accounts.`)
  console.log('Sign in as:', PEOPLE.map((p) => p.email).join(', '))
  console.log('Password for all three:', password)
  console.log('Remove it all with: npm run demo:purge')
}

/** Whoever approves that company in the demo, so the trail names a plausible person. */
function approverFor(code: string, users: Map<string, string>) {
  const person = PEOPLE.find((p) => p.codes.includes(code))
  return person ? (users.get(person.email) ?? null) : null
}

async function demoBatchId(companyGroupId: string) {
  const found = await prisma.batch.findFirst({
    where: { companyGroupId, label: 'Demo bills' },
    select: { id: true },
  })
  return found?.id ?? null
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
