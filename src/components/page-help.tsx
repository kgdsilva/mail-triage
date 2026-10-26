'use client'

import { useState } from 'react'
import { HelpCircle, X } from 'lucide-react'
import { HELP } from '@/lib/help'

/**
 * The question mark beside a screen's title.
 *
 * ---------------------------------------------------------------------------
 * Why it expands rather than floats
 * ---------------------------------------------------------------------------
 *
 * A popover over the page would be the obvious shape and is the one to avoid here. Two
 * of this project's worst afternoons went on menus that opened into a box with an
 * `overflow` set on it and were silently clipped — once to twelve per cent of their
 * height, with nothing on screen to say so. An inline panel cannot be clipped by an
 * ancestor it is already inside, so the entire class of bug does not apply.
 *
 * It also costs the reader nothing: the help is beneath the title, where they were
 * already looking, and pushes the screen down instead of covering it — so they can read
 * the explanation and the thing it explains at the same time.
 */
export function PageHelp({ topic }: { topic: keyof typeof HELP | string }) {
  const [open, setOpen] = useState(false)
  const help = HELP[topic]

  if (!help) return null

  return (
    <>
      {/*
        The question reads as the button rather than hiding behind a bare "?". A lone
        icon is only found by somebody already looking for help; the question itself is
        read in passing by somebody who did not know there was any.
      */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] font-semibold text-navy-700 transition-colors hover:border-navy-500 hover:bg-navy-50"
      >
        <HelpCircle className="size-3.5 text-navy-500" aria-hidden />
        {help.title}
      </button>

      {open && (
        <div className="mt-2 w-full rounded-xl border border-navy-500 bg-navy-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-[13.5px] font-bold text-navy-900">{help.title}</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="shrink-0 text-subtle transition-colors hover:text-navy-700"
            >
              <X className="size-4" aria-hidden />
              <span className="sr-only">Close</span>
            </button>
          </div>
          <div className="mt-1.5 space-y-1.5">
            {help.body.map((line) => (
              <p key={line.slice(0, 32)} className="text-[12.5px] leading-relaxed text-navy-900">
                {line}
              </p>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
