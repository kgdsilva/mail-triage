'use client'

import { useState } from 'react'
import { Check, Copy, Dices } from 'lucide-react'
import { generatePassword } from '@/lib/generate-password'

/**
 * A password you can read.
 *
 * Deliberately `type="text"`. A masked field protects a password from someone reading
 * over your shoulder, which is not the situation here: an admin is choosing a password
 * in order to tell somebody what it is, and masking it only bought typos. The Generate
 * button is the point — a password chosen by a person under time pressure is "colab2026",
 * and one from here is 80 bits of entropy that can still be read down the phone.
 */
export function PasswordField({
  name = 'password',
  placeholder = 'Password',
  value,
  onChange,
  compact = false,
}: {
  name?: string
  placeholder?: string
  value: string
  onChange: (next: string) => void
  compact?: boolean
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // A denied clipboard permission is not worth an error message: the password is
      // on screen in plain text, so it can be selected and copied by hand.
    }
  }

  const size = compact ? 'px-2 py-1 text-[12px]' : 'px-2.5 py-2 text-[13px]'

  return (
    <div className="flex items-stretch gap-1.5">
      <input
        name={name}
        type="text"
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`min-w-0 flex-1 rounded-lg border border-line bg-surface font-mono tracking-tight text-ink outline-none transition-colors placeholder:font-sans placeholder:text-subtle focus:border-navy-500 ${size}`}
      />
      <button
        type="button"
        onClick={() => onChange(generatePassword())}
        title="Generate a strong password"
        className="inline-flex flex-none items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[12px] font-semibold text-navy-700 transition-colors hover:border-navy-500 hover:bg-navy-50"
      >
        <Dices className="size-3.5" aria-hidden />
        Generate
      </button>
      {value && (
        <button
          type="button"
          onClick={copy}
          title="Copy to the clipboard"
          aria-label="Copy the password"
          className="inline-flex flex-none items-center gap-1 rounded-lg border border-line bg-surface px-2 text-[12px] font-semibold text-navy-700 transition-colors hover:border-navy-500 hover:bg-navy-50"
        >
          {copied ? (
            <>
              <Check className="size-3.5 text-ok-700" aria-hidden />
              Copied
            </>
          ) : (
            <Copy className="size-3.5" aria-hidden />
          )}
        </button>
      )}
    </div>
  )
}
