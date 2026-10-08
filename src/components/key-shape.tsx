import { apiKeyShape } from '@/server/eval'

/**
 * Which API key this deployment is running with, said without saying it.
 *
 * "The key was rejected" and "I pasted the new key" can both be true at once, and from
 * the outside there is no way to tell which value a deployment ended up with: one scoped
 * to the wrong environment, a build made before the change, and a correct key with a
 * newline stuck to it all produce the same rejection. Length usually settles it — two
 * keys are almost never the same length — and whitespace is the commonest way a right
 * key is refused.
 *
 * Nothing here can leak the key: a length, whether it begins with the public `sk-ant-`
 * scheme, and two booleans. No part of the random portion is read, compared or shown.
 *
 * `always` is for the Evaluation screen, where the question is being asked on purpose.
 * Everywhere else it stays silent while the key looks right, and speaks up only when the
 * shape itself is the explanation.
 */
export function KeyShape({ always = false }: { always?: boolean }) {
  const k = apiKeyShape()

  if (!k.present) {
    return (
      <p className="rounded-xl border border-danger-500 bg-danger-100 px-4 py-2.5 text-[12.5px] text-danger-700">
        <span className="font-bold">No ANTHROPIC_API_KEY reached this deployment.</span> The
        variable is missing, or it is scoped to a different environment.
      </p>
    )
  }

  const wrong = k.whitespace || k.quoted || !k.scheme
  if (!wrong && !always) return null

  return (
    <p
      className={`rounded-xl border px-4 py-2.5 text-[12.5px] ${
        wrong
          ? 'border-danger-500 bg-danger-100 text-danger-700'
          : 'border-line bg-surface text-muted'
      }`}
    >
      <span className="font-semibold">Key this build is using:</span>{' '}
      <span className="font-mono">{k.length} characters</span>
      {k.scheme ? '' : ' · does not start with sk-ant-'}
      {k.whitespace ? ' · has a space or newline around it' : ''}
      {k.quoted ? ' · wrapped in quotes' : ''}
      {wrong ? ' — that alone is why it is rejected.' : ' · no stray whitespace or quotes'}
      <span className="mt-0.5 block text-[11.5px] text-subtle">
        The value is never read or shown. Length is enough to tell one key from another: if
        this is not the length of the key you pasted, this deployment has a different one.
      </span>
    </p>
  )
}
