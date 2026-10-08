'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/server/db/client'
import { normalizeEmail } from '@/auth'
import { requireAdmin } from '@/server/session'
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
  /**
   * The other spellings this vendor's own paperwork uses, one per line.
   *
   * Without somewhere to type these the alias matching is a feature only the database
   * can use. "Jump Cloud", "JUMPCLOUD INC" and "JumpCloud, Inc." all arrive on real
   * invoices, and every one of them has to resolve to the single record that carries
   * the autopay rule — otherwise the archive grows three suppliers who are one company.
   */
  aliases: z.string().optional(),
})

/** Split on newlines or commas, trimmed, de-duplicated, blanks dropped. */
function parseAliases(raw: string | undefined) {
  if (!raw) return []
  const seen = new Set<string>()
  for (const part of raw.split(/[\n,]/)) {
    const t = part.trim()
    if (t) seen.add(t)
  }
  return [...seen]
}

export async function saveVendor(formData: FormData) {
  const session = await requireAdmin()
  const raw = Object.fromEntries(formData)
  const data = vendorSchema.parse({ ...raw, knownSpam: raw.knownSpam === 'on' })

  const aliases = parseAliases(data.aliases)

  if (data.id) {
    const { count } = await prisma.vendor.updateMany({
      where: { id: data.id, companyGroupId: session.companyGroupId },
      data: { name: data.name, knownSpam: data.knownSpam, notes: data.notes, aliases },
    })
    if (count === 0) throw new Error('Vendor not found')
  } else {
    await prisma.vendor.create({
      data: {
        name: data.name,
        knownSpam: data.knownSpam,
        notes: data.notes,
        aliases,
        companyGroupId: session.companyGroupId,
      },
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
  /// Checkbox is "covers only part", so the stored flag is its inverse.
  partial: z.coerce.boolean().default(false),
})

/**
 * Recording an autopay rule is the single most consequential configuration action in
 * the platform: it is what lets a bill be archived without a human deciding. So the
 * rule captures who confirmed it and when, and is time-bounded from the start.
 */
export async function saveAutopayRule(formData: FormData) {
  const session = await requireAdmin()
  const raw = Object.fromEntries(formData)
  const data = autopaySchema.parse({ ...raw, partial: raw.partial === 'on' })

  await prisma.autopayRule.create({
    data: {
      companyGroupId: session.companyGroupId,
      vendorId: data.vendorId,
      entityId: data.entityId,
      accountLast4: data.accountLast4 || null,
      paymentMethod: data.paymentMethod || null,
      effectiveFrom: new Date(`${data.effectiveFrom}T00:00:00Z`),
      coversFullBalance: !data.partial,
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
  role: z.enum(['OWNER', 'ADMIN', 'OPERATOR', 'MEMBER', 'VIEWER', 'UPLOADER']),
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

  // The readable copy travels with the hash — see setMemberPassword below for why it
  // exists and when it goes away. A password typed here has by definition not reached
  // the person yet.
  const pending = password ? { pendingPassword: password, pendingPasswordSetAt: new Date() } : {}

  // Users are global across company groups, so reuse an existing record rather than
  // creating a second one for the same person.

  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name: data.name || null, passwordHash, ...pending },
    update: {
      ...(data.name ? { name: data.name } : {}),
      // Only overwrite an existing password when a new one was actually typed.
      ...(passwordHash ? { passwordHash, ...pending } : {}),
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
      data: { passwordHash: null, pendingPassword: null, pendingPasswordSetAt: null },
    })
    revalidatePath('/settings/members')
    return
  }

  const problem = validatePassword(password)
  if (problem) throw new Error(problem)

  /*
   * Stored twice: the hash, which is what sign-in checks, and the password itself,
   * which is what somebody still has to be told.
   *
   * The readable copy exists because there is no reset email and no self-service
   * change in this app — a password only ever travels from one person to another, and
   * the one that goes missing is always the one that was set and not yet delivered.
   * It is cleared the moment that account signs in, so what sits here is only ever a
   * credential nobody has used yet.
   */
  await prisma.user.update({
    where: { id: membership.userId },
    data: {
      passwordHash: await hashPassword(password),
      pendingPassword: password,
      pendingPasswordSetAt: new Date(),
    },
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
 * Changes what a member may do.
 *
 * Added because the roles were only ever settable when the account was created, and the
 * one role people actually need to change is the narrow one: somebody is given upload
 * access on their first day and needs more later, or — the case this was written for —
 * an account already exists with more access than the job needs.
 *
 * Three refusals, each of which is a way to lock the group out or to escalate quietly:
 * nobody changes their own role, the last owner cannot be demoted, and only an owner
 * can create another owner.
 */
export async function setMemberRole(membershipId: string, role: string) {
  const session = await requireAdmin()

  const parsed = z
    .enum(['OWNER', 'ADMIN', 'OPERATOR', 'MEMBER', 'VIEWER', 'UPLOADER'])
    .safeParse(role)
  if (!parsed.success) throw new Error('Unknown role.')

  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, companyGroupId: session.companyGroupId },
    select: { id: true, role: true, userId: true },
  })
  if (!membership) throw new Error('Member not found')
  if (membership.role === parsed.data) return

  if (membership.userId === session.userId) {
    throw new Error('You cannot change your own role — ask another owner or admin.')
  }
  if (parsed.data === 'OWNER' && session.role !== 'OWNER') {
    throw new Error('Only an owner can make someone else an owner.')
  }
  if (membership.role === 'OWNER') {
    const owners = await prisma.membership.count({
      where: { companyGroupId: session.companyGroupId, role: 'OWNER', isActive: true },
    })
    if (owners <= 1) throw new Error('Cannot demote the last owner.')
  }

  await prisma.membership.update({
    where: { id: membership.id },
    data: { role: parsed.data },
  })
  revalidatePath('/settings/members')
}

/**
 * Who a refused bill goes back to — by role, never by name.
 *
 * Stored in CompanyGroup.settings beside the filename template and the auto-apply flag,
 * which is where this group's choices already live.
 *
 * A role rather than a person, because a role is held by whoever is currently doing the
 * job. Which role is the per-company part — see src/server/returns.ts for the default
 * and the fallback order.
 */
export async function setReturnedBillsRole(role: string) {
  const session = await requireAdmin()

  const parsed = z.enum(['OWNER', 'ADMIN', 'OPERATOR']).safeParse(role)
  if (!parsed.success) throw new Error('Choose one of the roles that works the mail.')

  const group = await prisma.companyGroup.findUniqueOrThrow({
    where: { id: session.companyGroupId },
    select: { settings: true },
  })

  await prisma.companyGroup.update({
    where: { id: session.companyGroupId },
    // Merged, not replaced: settings holds the filename template and the auto-apply
    // flag too, and writing a fresh object here would silently drop them.
    data: {
      settings: {
        ...((group.settings as Record<string, unknown> | null) ?? {}),
        returnedBillsRole: parsed.data,
      } as Prisma.InputJsonValue,
    },
  })

  revalidatePath('/', 'layout')
}

/**
 * Which companies a member may see.
 *
 * This is the approver assignment screen's one write. Stored on the membership rather
 * than in a table of its own because it is the same question for every narrow role —
 * "whose documents are yours" — and `Membership.entityScope` was declared for it from
 * the start and never wired up.
 *
 * An empty list means every company, which is right for an accountant (minus the
 * segregated one, which no non-administrator ever sees) and wrong for an approver — so
 * the screen says so rather than letting an empty box look like a configured one.
 */
export async function setMemberEntityScope(membershipId: string, entityIds: string[]) {
  const session = await requireAdmin()

  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, companyGroupId: session.companyGroupId },
    select: { id: true, role: true, entityScope: true },
  })
  if (!membership) throw new Error('Member not found')

  // Only ids that are real companies in this group, so a stale checkbox cannot park an
  // id that silently matches nothing later.
  const valid = await prisma.entity.findMany({
    where: { companyGroupId: session.companyGroupId, id: { in: entityIds } },
    select: { id: true },
  })

  await prisma.membership.update({
    where: { id: membership.id },
    data: { entityScope: valid.map((e) => e.id) },
  })

  revalidatePath('/', 'layout')
}

const categorySchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(60),
  sortOrder: z.coerce.number().int().default(0),
})

/** What the money was for. Editable, because every business splits spend differently. */
export async function saveCategory(formData: FormData) {
  const session = await requireAdmin()
  const data = categorySchema.parse(Object.fromEntries(formData))

  if (data.id) {
    const { count } = await prisma.category.updateMany({
      where: { id: data.id, companyGroupId: session.companyGroupId },
      data: { name: data.name, sortOrder: data.sortOrder },
    })
    if (count === 0) throw new Error('Category not found')
  } else {
    await prisma.category.create({
      data: { name: data.name, sortOrder: data.sortOrder, companyGroupId: session.companyGroupId },
    })
  }

  revalidatePath('/settings/categories')
}

/** Deactivated, never deleted: documents already filed against one must keep resolving. */
export async function toggleCategoryActive(id: string, isActive: boolean) {
  const session = await requireAdmin()
  const { count } = await prisma.category.updateMany({
    where: { id, companyGroupId: session.companyGroupId },
    data: { isActive },
  })
  if (count === 0) throw new Error('Category not found')
  revalidatePath('/settings/categories')
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

/**
 * Lets the reader commit its own decisions.
 *
 * Off by default, and deliberately a choice rather than a default: a reader that files
 * documents on its own is a different thing from one that proposes, and that is the
 * owner's call. Even switched on it only ever acts on a decision that cleared every
 * condition — the reading was clear, the entity and type are known, the filing rules
 * named a reason, and nothing was flagged ambiguous. Everything else still waits for a
 * person, and everything it does decide is recorded and reversible.
 */
export async function setAutoApply(enabled: boolean) {
  const session = await requireAdmin()

  const group = await prisma.companyGroup.findUniqueOrThrow({
    where: { id: session.companyGroupId },
    select: { settings: true },
  })
  const settings = { ...((group.settings as Record<string, unknown> | null) ?? {}) }
  settings.autoApply = enabled

  await prisma.companyGroup.update({
    where: { id: session.companyGroupId },
    data: { settings: settings as Prisma.InputJsonValue },
  })

  revalidatePath('/settings')
  revalidatePath('/review')
}
