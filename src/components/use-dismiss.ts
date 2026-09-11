'use client'

import { useEffect, useRef, type RefObject } from 'react'

/**
 * Closing a menu the way people expect: press anywhere else, or press Escape.
 *
 * Every dropdown in the app was a native `<details>`, which only closes by pressing the
 * same summary a second time. So the menu stayed up while you clicked around behind it,
 * and "press again to put it away" became a step in every interaction. This is the
 * missing half of opening something.
 *
 * `pointerdown` rather than `click`: it closes on the press, which feels immediate, and
 * it still fires when the press lands on something that stops the click from
 * propagating. The listeners only exist while something is open.
 *
 * Opening one also closes any other. The top bar has two independent popovers — the
 * workspace switcher and the nav menus — and each knowing only about itself was enough
 * to leave both hanging open at once. "A popover is open" is a fact about the page, so
 * it is tracked for the page.
 *
 * Returns the ref to put on the element that counts as "inside" — the trigger and the
 * panel together, or nothing will stay open long enough to press.
 */
/** Every popover currently open, by the function that closes it. */
const openPopovers = new Set<() => void>()

export function useDismiss<T extends HTMLElement>(
  open: boolean,
  close: () => void,
): RefObject<T | null> {
  const inside = useRef<T>(null)

  useEffect(() => {
    if (!open) return

    // Snapshot first: closing another one makes it remove itself from the set.
    for (const other of [...openPopovers]) if (other !== close) other()
    openPopovers.add(close)

    function away(event: PointerEvent) {
      if (!inside.current?.contains(event.target as Node)) close()
    }
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape') close()
    }

    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', key)
    return () => {
      openPopovers.delete(close)
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', key)
    }
  }, [open, close])

  return inside
}
