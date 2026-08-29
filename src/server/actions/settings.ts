'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/server/db/client'
import { normalizeEmail } from '@/auth'
import { requireAdmin, requireSession } from '@/server/session'
import { hashPassword, validatePassword } from '@/server/password'

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
  const session = await requireAdmin()
  const raw = Object.fromEntries(formData)
  const data = entitySchema.parse({ ...raw, isSegregated: raw.isSegregated === 'on' })

  if (data.id) {
    const { count } = await prisma.entity.updateMany({
      where: { id: data.id, companyGroupId: session.companyGroupId },
      data: {
        code: data.code,
        legalName: data.legalName,
        isSegregated: data.isSegregated,
        sortOrder: data.sortOrder,
      },
    })
    if (count === 0) throw new Error('Entity not found')
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
  const session = await requireAdmin()
  // updateMany, so the company group is part of the WHERE. A bare update by id would
  // let a member of one group flip an entity belonging to another.
  const { count } = await prisma.entity.updateMany({
    where: { id, companyGroupId: session.companyGroupId },
    data: { isActive },
  })
  if (count === 0) throw new Error('Entity not found')
  revalidatePath('/settings/entities')
}

const vendorSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1),
  knownSpam: z.coerce.boolean().default(false),
  notes: z.string().trim().optional(),
})

export async function saveVendor(formData: FormData) {
  const session = await requireAdmin()
  const raw = Object.fromEntries(formData)
  const data = vendorSchema.parse({ ...raw, knownSpam: raw.knownSpam === 'on' })

  if (data.id) {
    const { count } = await prisma.vendor.updateMany({
      where: { id: data.id, companyGroupId: session.companyGroupId },
      data: { name: data.name, knownSpam: data.knownSpam, notes: data.notes },
    })
    if (count === 0) throw new Error('Vendor not found')
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
  const session = await requireAdmin()
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
  const session = await requireAdmin()
  const { count } = await prisma.autopayRule.updateMany({
    where: { id, companyGroupId: session.companyGroupId },
    data: { effectiveTo: new Date() },
  })
  if (count === 0) throw new Error('Rule not found')
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
  const session = await requireAdmin()
  const data = typeSchema.parse(Object.fromEntries(formData))

  if (data.id) {
    const { count } = await prisma.documentType.updateMany({
      where: { id: data.id, companyGroupId: session.companyGroupId },
      data: {
        code: data.code,
        label: data.label,
        defaultAction: data.defaultAction,
        sortOrder: data.sortOrder,
      },
    })
    if (count === 0) throw new Error('Document type not found')
  } else {
    await prisma.documentType.create({
      data: { ...data, id: undefined, companyGroupId: session.companyGroupId },
    })
  }

  revalidatePath('/settings/types')
}

const memberSchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().optional(),
  role: z.enum(['OWNER', 'ADMIN', 'OPERATOR', 'MEMBER', 'VIEWER']),
  /// Blank means Google-only: the person signs in with Google and never has a password.
  password: z.string().optional(),
})

/**
 * Adds someone to the workspace.
 *
 * This is the allowlist that authentication checks against: until an email appears
 * here, signing in is refused whichever method they use. There is no invitation email
 * and no self-signup.
 *
 * Setting a password is optional. Leave it blank for someone who will sign in with
 * Google; set one for someone who has no Workspace account, and hand it to them
 * directly. Either way the same email is the identity, so a person given a password
 * today can still sign in with Google later.
 */
export async function addMember(formData: FormData) {
  const session = await requireAdmin()
  const data = memberSchema.parse(Object.fromEntries(formData))
  const email = normalizeEmail(data.email)

  const password = data.password?.trim() || null
  let passwordHash: string | undefined
  if (password) {
    const problem = validatePassword(password)
    if (problem) throw new Error(problem)
    passwordHash = await hashPassword(password)
  }

  // Users are global across company groups, so reuse an existing record rather than
  // creating a second one for the same person.
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name: data.name || null, passwordHash },
    update: {
      ...(data.name ? { name: data.name } : {}),
      // Only overwrite an existing password when a new one was actually typed.
      ...(passwordHash ? { passwordHash } : {}),
    },
  })

  await prisma.membership.upsert({
    where: { userId_companyGroupId: { userId: user.id, companyGroupId: session.companyGroupId } },
    create: { userId: user.id, companyGroupId: session.companyGroupId, role: data.role },
    update: { role: data.role, isActive: true },
  })

  revalidatePath('/settings/members')
}

/**
 * Sets or replaces a member's password, or clears it back to Google-only.
 *
 * Admin-set only: there is no self-service change and no reset email. If someone
 * forgets their password, an admin sets a new one here and tells them what it is.
 */
export async function setMemberPassword(membershipId: string, formData: FormData) {
  const session = await requireAdmin()

  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, companyGroupId: session.companyGroupId },
    select: { userId: true },
  })
  if (!membership) throw new Error('Member not found')

  const password = String(formData.get('password') ?? '').trim()

  if (!password) {
    // Clearing the password does not remove access — it leaves Google as the only way
    // in for that person, which is the state every Google-only member is already in.
    await prisma.user.update({
      where: { id: membership.userId },
      data: { passwordHash: null },
    })
    revalidatePath('/settings/members')
    return
  }

  const problem = validatePassword(password)
  if (problem) throw new Error(problem)

  await prisma.user.update({
    where: { id: membership.userId },
    data: { passwordHash: await hashPassword(password) },
  })

  revalidatePath('/settings/members')
}

/**
 * Revokes access. Deactivating rather than deleting keeps the person resolvable on the
 * documents they were assigned, and takes effect on their next request rather than when
 * their session expires.
 */
export async function setMemberActive(membershipId: string, isActive: boolean) {
  const session = await requireAdmin()

  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, companyGroupId: session.companyGroupId },
  })
  if (!membership) throw new Error('Member not found')

  // Refuse to remove the last remaining admin, which would lock everyone out of
  // configuration with no way back in through the UI.
  if (!isActive && membership.role === 'OWNER') {
    const owners = await prisma.membership.count({
      where: { companyGroupId: session.companyGroupId, role: 'OWNER', isActive: true },
    })
    if (owners <= 1) throw new Error('Cannot remove the last owner.')
  }

  await prisma.membership.update({ where: { id: membershipId }, data: { isActive } })
  revalidatePath('/settings/members')
}

/**
 * The details that let a scan be matched to the right entity.
 *
 * Aliases are the ones that matter. A document never says "MMT" — it says "Marsh &
 * Munar Team LLC", or a DBA the company trades under, or nothing but an EIN. Both the
 * filename parser and the AI reader match against these, so this screen is what makes
 * automatic entity recognition work at all.
 */
const entityDetailSchema = z.object({
  id: z.string().min(1),
  code: z.string().trim().min(1).max(12).toUpperCase(),
  legalName: z.string().trim().min(1),
  ein: z.string().trim().max(20).optional(),
  state: z.string().trim().max(40).optional(),
  isSegregated: z.coerce.boolean().default(false),
  sortOrder: z.coerce.number().int().default(0),
})

export async function saveEntityDetail(formData: FormData) {
  const session = await requireAdmin()
  const raw = Object.fromEntries(formData)
  const data = entityDetailSchema.parse({ ...raw, isSegregated: raw.isSegregated === 'on' })

  const entity = await prisma.entity.findFirst({
    where: { id: data.id, companyGroupId: session.companyGroupId },
    select: { id: true, metadata: true },
  })
  if (!entity) throw new Error('Entity not found')

  // metadata is a free-form bag shared with whatever else a group needs; merge rather
  // than replace so editing the EIN never drops a key something else put there.
  const metadata: Record<string, unknown> = {
    ...((entity.metadata as Record<string, unknown> | null) ?? {}),
  }
  // A cleared field removes the key rather than storing an empty string.
  if (data.ein) metadata.ein = data.ein
  else delete metadata.ein
  if (data.state) metadata.state = data.state
  else delete metadata.state

  await prisma.entity.update({
    where: { id: entity.id },
    data: {
      code: data.code,
      legalName: data.legalName,
      isSegregated: data.isSegregated,
      sortOrder: data.sortOrder,
      metadata: metadata as Prisma.InputJsonValue,
    },
  })

  revalidatePath('/settings/entities')
  revalidatePath(`/settings/entities/${entity.id}`)
}

/**
 * Adds one alias. Several may point at the same entity — a legal name, a trading name,
 * an EIN as printed on a notice.
 */
export async function addEntityAlias(entityId: string, formData: FormData) {
  const session = await requireAdmin()

  const entity = await prisma.entity.findFirst({
    where: { id: entityId, companyGroupId: session.companyGroupId },
    select: { id: true },
  })
  if (!entity) throw new Error('Entity not found')

  const aliasText = String(formData.get('aliasText') ?? '').trim()
  const source = String(formData.get('source') ?? 'NAME')
  if (!aliasText) return

  if (!['NAME', 'ADDRESS', 'EIN', 'ACCOUNT_NUMBER'].includes(source)) {
    throw new Error('Unknown alias type')
  }

  // Adding the same alias twice is a no-op rather than an error — this screen gets
  // typed into repeatedly while someone works through a pile of documents.
  await prisma.entityAlias.upsert({
    where: { entityId_aliasText: { entityId: entity.id, aliasText } },
    create: { entityId: entity.id, aliasText, source: source as never },
    update: { source: source as never },
  })

  revalidatePath(`/settings/entities/${entity.id}`)
  revalidatePath('/settings/entities')
}

export async function removeEntityAlias(aliasId: string) {
  const session = await requireAdmin()

  const alias = await prisma.entityAlias.findFirst({
    where: { id: aliasId, entity: { companyGroupId: session.companyGroupId } },
    select: { id: true, entityId: true },
  })
  if (!alias) throw new Error('Alias not found')

  await prisma.entityAlias.delete({ where: { id: alias.id } })
  revalidatePath(`/settings/entities/${alias.entityId}`)
  revalidatePath('/settings/entities')
}
