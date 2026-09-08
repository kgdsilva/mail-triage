/**
 * A password that is strong enough to be the only thing guarding an account, and plain
 * enough to read down the phone.
 *
 * Four groups of four from a 32-character alphabet is 80 bits of entropy — far past
 * anything that gets guessed — while staying typable by someone who was told it out
 * loud. The alphabet leaves out the characters that get misheard or mistyped: no l or 1,
 * no o or 0, and no capitals, so nobody has to be told "lowercase L, not the number".
 *
 * Generated in the browser, from the platform's CSPRNG. It never travels anywhere it
 * would not have travelled anyway — the person setting it types it into the same form.
 */
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'
const GROUPS = 4
const GROUP_LENGTH = 4

export function generatePassword() {
  const bytes = new Uint32Array(GROUPS * GROUP_LENGTH)
  crypto.getRandomValues(bytes)

  const chars = Array.from(bytes, (n) => ALPHABET[n % ALPHABET.length])
  const groups: string[] = []
  for (let i = 0; i < GROUPS; i += 1) {
    groups.push(chars.slice(i * GROUP_LENGTH, (i + 1) * GROUP_LENGTH).join(''))
  }
  return groups.join('-')
}
