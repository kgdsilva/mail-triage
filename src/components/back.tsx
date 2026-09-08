'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { BTN } from '@/lib/theme'

/**
 * The way back, when the way back is known.
 *
 * A breadcrumb already said where you were, but it said it in small text links — which
 * is exactly the thing that reads as writing rather than as a control. This is the same
 * destination as a button you can see.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className={BTN.quiet}>
      <ArrowLeft className="size-3.5" aria-hidden />
      {label}
    </Link>
  )
}

/**
 * The way back when only the browser knows it.
 *
 * A document is opened from the master log, from the review sweep and from a queue
 * card, so no single href is the right destination — going "up" would send someone
 * somewhere they have never been. History answers it properly.
 *
 * The fallback is for a link opened in a fresh tab, where there is no history to pop
 * and `router.back()` would be a button that does nothing.
 */
export function BackButton({
  fallbackHref,
  label = 'Back',
}: {
  fallbackHref: string
  label?: string
}) {
  const router = useRouter()

  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back()
        else router.push(fallbackHref)
      }}
      className={BTN.quiet}
    >
      <ArrowLeft className="size-3.5" aria-hidden />
      {label}
    </button>
  )
}
