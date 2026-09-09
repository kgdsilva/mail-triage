'use client'

import { receiptUploadMode, signReceiptUpload } from '@/server/actions/payments'

export type PreparedReceipt = { key: string; filename: string; contentType: string }

/**
 * Gets a receipt's bytes to storage before the payment is recorded.
 *
 * Two paths, for the same reason document uploads have two: Vercel caps a request body
 * at 4.5 MB on every plan, and a photo of a receipt taken on a phone clears that
 * without trying. So the browser PUTs straight to object storage and the server is only
 * told the key afterwards.
 *
 * Local development has no object storage, so `direct` is false there and the file
 * travels inside the form action instead — which is fine, because nothing local is
 * behind a 4.5 MB limit. Returning null means "send the file yourself".
 */
export async function prepareReceipt(file: File): Promise<PreparedReceipt | null> {
  const { direct } = await receiptUploadMode()
  if (!direct) return null

  const contentType = file.type || 'application/pdf'
  const { key, url } = await signReceiptUpload(file.name, contentType, file.size)

  const put = await fetch(url, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': contentType },
  })
  if (!put.ok) throw new Error(`Storage refused the receipt (${put.status})`)

  return { key, filename: file.name, contentType }
}
