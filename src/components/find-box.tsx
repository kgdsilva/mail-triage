'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Search } from 'lucide-react'

/**
 * "Where is this?", answerable from any screen.
 *
 * The app had three queues named after places — Bills to approve, Needs a decision,
 * Accounting — and no place named after the question everybody actually arrives with.
 * So when something was not in the queue you happened to open, the only available
 * conclusion was that it had been lost, and the way to check was to open the other two
 * and then disbelieve them. An afternoon went that way over a file that was exactly
 * where it belonged.
 *
 * This is deliberately not a fourth queue. It goes to the Master log, which has always
 * held every document and already knew how to search; what was missing was a door to it
 * from the screen you are standing on, and a sentence on each row saying whose turn the
 * thing is on. A search that returns a filename and leaves you to work out what it means
 * is the same dead end in a new place.
 */
export function FindBox() {
  const router = useRouter()
  const [q, setQ] = useState('')

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const term = q.trim()
        if (term) router.push(`/log?q=${encodeURIComponent(term)}`)
      }}
      className="relative hidden w-full min-w-0 sm:block"
      role="search"
    >
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-navy-100"
        aria-hidden
      />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        /* Named for the question, not the mechanism. "Search" is what the box is;
           "find a bill" is what the person came to do. */
        placeholder="Find a bill, receipt or cheque…"
        aria-label="Find a document, anywhere in the app"
        /* Fills whatever the bar has left rather than claiming a fixed width: an
           administrator's bar carries four menus, and a box that insisted on 14rem
           pushed them into each other. */
        className="w-full rounded-lg border border-navy-700 bg-navy-900/60 py-1.5 pl-8 pr-2.5 text-[12.5px] text-white placeholder:text-navy-100/70 outline-none focus:border-gold-500"
      />
    </form>
  )
}
