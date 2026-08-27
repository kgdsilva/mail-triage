import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'

/**
 * Document storage. The platform is the source of truth for files, not Box or Drive.
 *
 * Local disk in development, S3-compatible object storage (Cloudflare R2) in
 * production. Both are addressed by the same opaque `key` recorded on the Document
 * row, so switching backends never requires touching document records.
 */

export type PutResult = { key: string; bucket: string; byteSize: number; sha256: string }

const LOCAL_ROOT = path.join(process.cwd(), '.storage')
const LOCAL_BUCKET = 'local'

function useS3() {
  return Boolean(process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY_ID)
}

/**
 * Keys are namespaced by company group and randomised. The original filename is *not*
 * part of the key: scanned mail names can carry entity and vendor details, and object
 * keys leak into logs and URLs more readily than database columns do.
 */
export function buildKey(companyGroupId: string, extension: string) {
  const ext = extension.replace(/^\.+/, '').toLowerCase() || 'bin'
  return `${companyGroupId}/${randomUUID()}.${ext}`
}

async function s3Client() {
  const { S3Client } = await import('@aws-sdk/client-s3')
  return new S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  })
}

export async function putObject(
  key: string,
  bytes: Buffer,
  contentType: string,
): Promise<PutResult> {
  const sha256 = createHash('sha256').update(bytes).digest('hex')

  if (useS3()) {
    const bucket = process.env.S3_BUCKET!
    const { PutObjectCommand } = await import('@aws-sdk/client-s3')
    const client = await s3Client()
    await client.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType }),
    )
    return { key, bucket, byteSize: bytes.byteLength, sha256 }
  }

  const target = path.join(LOCAL_ROOT, key)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, bytes)
  return { key, bucket: LOCAL_BUCKET, byteSize: bytes.byteLength, sha256 }
}

export async function getObject(key: string, bucket: string | null): Promise<Buffer> {
  if (bucket && bucket !== LOCAL_BUCKET) {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3')
    const client = await s3Client()
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    return Buffer.from(await res.Body!.transformToByteArray())
  }
  return readFile(path.join(LOCAL_ROOT, key))
}

/** Only used to roll back a failed upload — filed documents are never deleted. */
export async function deleteObject(key: string, bucket: string | null) {
  if (bucket && bucket !== LOCAL_BUCKET) {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3')
    const client = await s3Client()
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    return
  }
  await unlink(path.join(LOCAL_ROOT, key)).catch(() => {})
}
