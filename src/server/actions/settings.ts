'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
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
