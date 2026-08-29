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

/**
 * Reads an S3 setting, trimmed, and refuses anything that cannot legally go in an HTTP
 * header.
 *
 * The access key id and region are interpolated verbatim into the Authorization header
 * the AWS signer builds (`Credential=<id>/<date>/<region>/s3/aws4_request`). A value
 * pasted through a dashboard with a trailing newline or a smart quote therefore fails
 * deep inside Node's HTTP layer as `ERR_INVALID_CHAR: Invalid character in header
 * content ["authorization"]`, which names neither the variable nor the cause. Catching
 * it here turns that into a sentence that says which variable is wrong.
 *
 * The secret key is different: it only derives an HMAC and never reaches a header, so a
 * bad character there surfaces as a signature mismatch (403) instead. It is trimmed
 * anyway, since a trailing newline breaks the signature just as quietly.
 */
function s3Env(name: string): string | undefined {
  const raw = process.env[name]
  if (raw === undefined) return undefined

  // Surrounding quotes survive a copy out of a .env file or a docs snippet. They are
  // valid header characters, so they would not trip the check below — they would just
  // corrupt the signature and come back as an opaque 403. No R2 credential is quoted.
  const value = raw.trim().replace(/^(['"])([\s\S]*)\1$/, '$2').trim()
  if (value === '') return undefined

  // Printable US-ASCII only — the range HTTP header values actually allow.
  if (!/^[\x20-\x7E]*$/.test(value)) {
    throw new Error(
      `${name} contains a character that cannot be sent in an HTTP header. ` +
        'Re-copy it from Cloudflare and paste it without surrounding quotes or line breaks.',
    )
  }
  return value
}

function useS3() {
  return Boolean(s3Env('S3_ENDPOINT') && s3Env('S3_ACCESS_KEY_ID'))
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
  const accessKeyId = s3Env('S3_ACCESS_KEY_ID')
  const secretAccessKey = s3Env('S3_SECRET_ACCESS_KEY')
  const endpoint = s3Env('S3_ENDPOINT')

  if (!accessKeyId || !secretAccessKey || !endpoint) {
    throw new Error(
      'Object storage is not configured: S3_ENDPOINT, S3_ACCESS_KEY_ID and ' +
        'S3_SECRET_ACCESS_KEY must all be set.',
    )
  }

  const { S3Client } = await import('@aws-sdk/client-s3')
  return new S3Client({
    region: s3Env('S3_REGION') || 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  })
}

export function storageBucket() {
  const bucket = s3Env('S3_BUCKET')
  if (!bucket) throw new Error('S3_BUCKET is not set.')
  return bucket
}

export async function putObject(
  key: string,
  bytes: Buffer,
  contentType: string,
): Promise<PutResult> {
  const sha256 = createHash('sha256').update(bytes).digest('hex')

  if (useS3()) {
    const bucket = storageBucket()
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

/** True when uploads can go straight from the browser to object storage. */
export function supportsDirectUpload() {
  return useS3()
}

/**
 * A short-lived URL the browser can PUT a file to, bypassing the app server entirely.
 *
 * This is not an optimisation. Vercel caps a function's request body at 4.5 MB on every
 * plan, so a 50 MB scan can never reach a server action at all — it is rejected at the
 * platform edge before any of our code runs. Signing a URL and letting the browser talk
 * to R2 directly is the only way these files arrive.
 *
 * The signature covers the content type, so the browser cannot upload something other
 * than what it declared, and the key is server-chosen so it cannot write outside its
 * company group's prefix.
 */
export async function presignPut(key: string, contentType: string, expiresIn = 900) {
  const { PutObjectCommand } = await import('@aws-sdk/client-s3')
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')
  const client = await s3Client()

  return getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: storageBucket(), Key: key, ContentType: contentType }),
    { expiresIn },
  )
}

/**
 * Confirms an object really landed, and how big it is.
 *
 * The browser reports its own file size when registering an upload; this is what makes
 * the recorded byte size the storage's answer rather than the client's claim.
 */
export async function headObject(key: string): Promise<{ byteSize: number } | null> {
  const { HeadObjectCommand } = await import('@aws-sdk/client-s3')
  const client = await s3Client()
  try {
    const res = await client.send(
      new HeadObjectCommand({ Bucket: storageBucket(), Key: key }),
    )
    return { byteSize: res.ContentLength ?? 0 }
  } catch {
    return null
  }
}
