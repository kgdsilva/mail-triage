'use client'

import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { PaymentForm, type PaymentEntity } from '@/components/payment-form'
import { BTN } from '@/lib/theme'

/**
 * Entering a payment that never came through the platform.
 *
 * A panel rather than a separate page: it is the same form the bills screen uses, and
 * the history it lands in is right behind it, so there is nowhere better to be.
 */
export function ManualPayment({ entities }: { entities: PaymentEntity[] }) {
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  if (!open) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        {done && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-100 px-2.5 py-1 text-[12px] font-semibold text-ok-700">
            {done}
            <button
              type="button"
              onClick={() => setDone(null)}
              aria-label="Dismiss"
              className="grid size-4 place-items-center rounded-full hover:bg-surface"
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
        )}
        <button type="button" onClick={() => setOpen(true)} className={BTN.primary}>
          <Plus className="size-3.5" aria-hidden />
          Record a payment
        </button>
      </span>
    )
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-auto bg-navy-900/25 p-4 sm:p-10">
      <div className="w-full max-w-2xl rounded-xl border border-line bg-surface p-5 shadow-[0_16px_40px_rgba(18,40,74,0.24)]">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex-1">
            <h2 className="text-[17px] font-bold text-navy-900">Record a payment</h2>
            <p className="mt-0.5 text-[12.5px] text-muted">
              For a bill paid outside the platform, or one whose scan never arrived. It
              goes into the history exactly like a bill marked paid on the other screen.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="grid size-7 flex-none place-items-center rounded-lg text-subtle transition-colors hover:bg-navy-50 hover:text-navy-700"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <PaymentForm
          entities={entities}
          onCancel={() => setOpen(false)}
          onDone={(message) => {
            setDone(message)
            setOpen(false)
          }}
        />
      </div>
    </div>
  )
}
