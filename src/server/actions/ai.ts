'use server'

import { revalidatePath } from 'next/cache'
import { analyzeDocument, type AiSuggestion } from '@/server/ai/suggest'
import { aiConfigured } from '@/server/ai/read-document'
import { requireTriage } from '@/server/session'

/**
 * Reads a document and returns the proposal, without committing anything.
 *
 * Called from the classify screen when a document has not been read yet, and by the
 * background pass that runs after an upload. Reading is cached on the record, so this
 * is safe to call repeatedly — it only costs money the first time, or when forced.
 */
export async function analyzeForClassify(
  documentId: string,
  force = false,
): Promise<{ ok: boolean; suggestion?: AiSuggestion; error?: string }> {
  const session = await requireTriage()
  const result = await analyzeDocument(session.companyGroupId, documentId, { force })

  if (result.ok) {
    revalidatePath(`/classify/${documentId}`)
    revalidatePath('/review')
  }
  return result
}

export async function isAiAvailable() {
  await requireTriage()
  return aiConfigured()
}
