import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto'
import { promisify } from 'node:util'

// promisify picks the 3-argument overload, which drops the options we need to set the
// cost parameters. Narrowing to the 4-argument form first keeps the result typed.
const scrypt = promisify(
  scryptCb as (
    password: string,
    salt: Buffer,
    keylen: number,
    options: ScryptOptions,
    callback: (err: Error | null, derivedKey: Buffer) => void,
  ) => void,
)

/**
 * Password hashing for the credentials sign-in.
 *
 * scrypt from Node's standard library rather than bcrypt or argon2: it is memory-hard,
 * it is what the platform already ships, and it keeps a security-critical dependency
 * out of the supply chain for a handful of internal accounts.
 *
 * Stored as `scrypt$N$r$p$salt$hash`, all base64url. The parameters travel with the hash
 * so they can be raised later without invalidating existing passwords.
 */

const N = 1 << 15 // CPU/memory cost — ~100ms per hash on a modern laptop
const r = 8
const p = 1
const KEY_LEN = 32
const SALT_LEN = 16

// scrypt needs memory proportional to 128 * N * r; the default 32MB cap is too low
// for N = 2^15, so raise it to 64MB with headroom.
const MAX_MEM = 128 * N * r * 2

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN)
  const key = await scrypt(password.normalize('NFKC'), salt, KEY_LEN, {
    N,
    r,
    p,
    maxmem: MAX_MEM,
  })

  return ['scrypt', N, r, p, salt.toString('base64url'), key.toString('base64url')].join('$')
}

/**
 * Constant-time verification. Returns false rather than throwing on a malformed or
 * absent hash, so a caller can treat "no password set" and "wrong password" alike —
 * revealing which one it was would tell an attacker whether an account exists.
 */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false

  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false

  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts
  const nVal = Number(nRaw)
  const rVal = Number(rRaw)
  const pVal = Number(pRaw)
  if (!Number.isInteger(nVal) || !Number.isInteger(rVal) || !Number.isInteger(pVal)) return false

  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(saltRaw, 'base64url')
    expected = Buffer.from(hashRaw, 'base64url')
  } catch {
    return false
  }
  if (expected.length === 0) return false

  let actual: Buffer
  try {
    actual = await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N: nVal,
      r: rVal,
      p: pVal,
      maxmem: 128 * nVal * rVal * 2,
    })
  } catch {
    return false
  }

  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/** Minimum we enforce on admin-set passwords. Length beats composition rules. */
export const MIN_PASSWORD_LENGTH = 10

export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
  }
  if (password.length > 200) return 'Password is too long'
  return null
}
