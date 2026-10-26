'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/server/db/client'
import { visibleEntityIds } from '@/server/scope'
import { requireTriage } from '@/server/session'

export type Saved = { ok: true } | { ok: false; error: string }

/**
 * Setting a document's spend category by hand.
 *
 * Until now nothing could. The only writers were the backfill and the reader's
 * suggestion, which meant a category this platform got wrong was a category nobody could
 * put right — and it got a hundred of them wrong at once, from a list that described the
 * wrong kind of company. A machine that can file but not be corrected is a machine whose
 * mistakes are permanent.
 *
 * Null is a real answer, not a cleared field. A cheque received has no spend category,
 * and "none" has to be sayable or the only way to express it is a wrong one.
 */
export async function setDocumentCategory(
  documentId: string,
  categoryId: string | null,
): Promise<Saved> {
  try {
    const session = await requireTriage()

    const scope = await visibleEntityIds(session)
    const doc = await prisma.document.findFirst({
      where: {
        id: documentId,
        companyGroupId: session.companyGroupId,
        deletedAt: null,
        ...(scope === null ? {} : { entityId: { in: scope } }),
      },
      select: { id: true, category: { select: { name: true } } },
    })
    if (!doc) return { ok: false, error: 'That document is not yours to change.' }

    let name: string | null = null
    if (categoryId) {
      const category = await prisma.category.findFirst({
        where: { id: categoryId, companyGroupId: session.companyGroupId },
        select: { name: true },
      })
      if (!category) return { ok: false, error: 'That category is not in this workspace.' }
      name = category.name
    }

    await prisma.$transaction(async (tx) => {
      await tx.document.update({ where: { id: doc.id }, data: { categoryId } })
      await tx.documentEvent.create({
        data: {
          documentId: doc.id,
          actorUserId: session.userId,
          action: 'recategorised',
          toValue: {
            category: name,
            // `by_hand` is what makes this answer outrank every later automatic pass:
            // the re-read and the rule repair both skip anything already recategorised,
            // so a person's correction is final unless another person changes it.
            via: 'by_hand',
            wasCategory: doc.category?.name ?? null,
          },
        },
      })
    })

    revalidatePath('/log')
    revalidatePath('/settings/categories')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'That could not be saved.' }
  }
}
