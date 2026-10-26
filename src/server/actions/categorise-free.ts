'use server'

import { revalidatePath } from 'next/cache'
import {
  applyPlacements,
  applyRepairs,
  placementDryRun,
  repairDryRun,
} from '@/server/categorise-free'
import { requireAdmin } from '@/server/session'

/**
 * Placing what the filenames and vendors already say, before paying to read anything.
 *
 * Two actions and not one: the count is shown before the button, because "this would
 * place 174 of 313 for nothing" is the fact that decides whether to press it, and
 * finding that out by pressing it is not a choice.
 */

export async function previewPlacements() {
  const session = await requireAdmin()
  return placementDryRun(session.companyGroupId)
}

export async function runPlacements() {
  const session = await requireAdmin()
  const result = await applyPlacements(session.companyGroupId, session.userId)
  revalidatePath('/', 'layout')
  return result
}

export async function previewRepairs() {
  const session = await requireAdmin()
  return repairDryRun(session.companyGroupId)
}

export async function runRepairs() {
  const session = await requireAdmin()
  const result = await applyRepairs(session.companyGroupId, session.userId)
  revalidatePath('/', 'layout')
  return result
}
