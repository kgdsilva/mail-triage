'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { prisma } from '@/server/db/client'
import { requireSession } from '@/server/session'

/**
 * Configuration lives in the database, not in code, so onboarding a second company
 * group never means a deploy. Every write here is scoped to the caller's group.
 */

const entitySchema = z.object({
  id: z.string().optional(),
  code: z.string().trim().min(1).max(12).toUpperCase(),
  legalName: z.string().trim().min(1),
  isSegregated: z.coerce.boolean().default(false),
  sortOrder: z.coerce.number().int().default(0),
})

export async function saveEntity(formData: FormData) {
  const session = await requireSession()
  const raw = Object.fromEntries(formData)
  const data = entitySchema.parse({ ...raw, isSegregated: raw.isSegregated === 'on' })

  if (data.id) {
    await prisma.entity.update({
      where: { id: data.id },
      data: {
        code: data.code,
        legalName: data.legalName,
        isSegregated: data.isSegregated,
        sortOrder: data.sortOrder,
      },
    })
  } else {
    await prisma.entity.create({
      data: { ...data, id: undefined, companyGroupId: session.companyGroupId },
    })
  }

  revalidatePath('/settings/entities')
}

/**
 * Entities are deactivated, never deleted: documents already filed against one must
 * keep resolving to it.
 */
export async function toggleEntityActive(id: string, isActive: boolean) {
  await requireSession()
  await prisma.entity.update({ where: { id }, data: { isActive } })
  revalidatePath('/settings/entities')
}

const vendorSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1),
  knownSpam: z.coerce.boolean().default(false),
  notes: z.string().trim().optional(),
})

export async function saveVendor(formData: FormData) {
  const session = await requireSession()
  const raw = Object.fromEntries(formData)
  const data = vendorSchema.parse({ ...raw, knownSpam: raw.knownSpam === 'on' })

  if (data.id) {
    await prisma.vendor.update({
      where: { id: data.id },
      data: { name: data.name, knownSpam: data.knownSpam, notes: data.notes },
    })
  } else {
    await prisma.vendor.create({
      data: { ...data, id: undefined, companyGroupId: session.companyGroupId },
    })
  }

  revalidatePath('/settings/vendors')
}

const autopaySchema = z.object({
  vendorId: z.string().min(1),
  entityId: z.string().min(1),
  accountLast4: z.string().trim().max(4).optional(),
  paymentMethod: z.string().trim().optional(),
  effectiveFrom: z.string().min(1),
  notes: z.string().trim().optional(),
})

/**
 * Recording an autopay rule is the single most consequential configuration action in
 * the platform: it is what lets a bill be archived without a human deciding. So the
 * rule captures who confirmed it and when, and is time-bounded from the start.
 */
export async function saveAutopayRule(formData: FormData) {
  const session = await requireSession()
  const data = autopaySchema.parse(Object.fromEntries(formData))

  await prisma.autopayRule.create({
    data: {
      companyGroupId: session.companyGroupId,
      vendorId: data.vendorId,
      entityId: data.entityId,
      accountLast4: data.accountLast4 || null,
      paymentMethod: data.paymentMethod || null,
      effectiveFrom: new Date(`${data.effectiveFrom}T00:00:00Z`),
      confirmedByUserId: session.userId,
      notes: data.notes || null,
    },
  })

  revalidatePath('/settings/autopay')
}

/**
 * Ends a rule rather than deleting it. A document filed while the rule was live must
 * still show why it was archived.
 */
export async function endAutopayRule(id: string) {
  await requireSession()
  await prisma.autopayRule.update({
    where: { id },
    data: { effectiveTo: new Date() },
  })
  revalidatePath('/settings/autopay')
}

const typeSchema = z.object({
  id: z.string().optional(),
  code: z.string().trim().min(1).toUpperCase(),
  label: z.string().trim().min(1),
  defaultAction: z.enum(['ARCHIVE', 'ACTION', 'ASK']),
  sortOrder: z.coerce.number().int().default(0),
})

export async function saveDocumentType(formData: FormData) {
  const session = await requireSession()
  const data = typeSchema.parse(Object.fromEntries(formData))

  if (data.id) {
    await prisma.documentType.update({
      where: { id: data.id },
      data: {
        code: data.code,
        label: data.label,
        defaultAction: data.defaultAction,
        sortOrder: data.sortOrder,
      },
    })
  } else {
    await prisma.documentType.create({
      data: { ...data, id: undefined, companyGroupId: session.companyGroupId },
    })
  }

  revalidatePath('/settings/types')
}
