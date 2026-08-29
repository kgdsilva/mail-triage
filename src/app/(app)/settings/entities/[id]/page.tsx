import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, X } from 'lucide-react'
import { EntityBadge } from '@/components/badges'
import {
  addEntityAlias,
  removeEntityAlias,
  saveEntityDetail,
  toggleEntityActive,
} from '@/server/actions/settings'
import { prisma } from '@/server/db/client'
import { requireAdmin } from '@/server/session'
import { BTN, INPUT } from '@/lib/theme'

export const dynamic = 'force-dynamic'

const ALIAS_SOURCES = [
  { value: 'NAME', label: 'Name' },
  { value: 'ADDRESS', label: 'Address' },
  { value: 'EIN', label: 'EIN' },
  { value: 'ACCOUNT_NUMBER', label: 'Account no.' },
]

export default async function EntityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await requireAdmin()
  const { id } = await params

  const entity = await prisma.entity.findFirst({
    where: { id, companyGroupId: session.companyGroupId },
    include: {
      aliases: { orderBy: { aliasText: 'asc' } },
      _count: { select: { documents: true } },
    },
  })
  if (!entity) notFound()

  const meta = (entity.metadata as Record<string, unknown> | null) ?? {}
  const ein = typeof meta.ein === 'string' ? meta.ein : ''
  const state = typeof meta.state === 'string' ? meta.state : ''

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <Link
          href="/settings/entities"
          className="inline-flex items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-navy-700"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          All entities
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <EntityBadge code={entity.code} index={entity.sortOrder} />
          <h1 className="text-[22px] font-bold tracking-tight text-navy-900">
            {entity.legalName}
          </h1>
          <span className="text-[13px] text-subtle">{entity._count.documents} documents</span>
        </div>
      </div>

      {/* --- how a scan gets matched to this entity -------------------------- */}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(18,40,74,0.05)]">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.09em] text-navy-900">
          Also known as
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          A document never says “{entity.code}”. It says a legal name, a trading name, or
          nothing but an EIN. Every alias here is matched against incoming scans — by the
          filename parser and by the AI reader — so this list is what makes the entity get
          recognised automatically.
        </p>

        <ul className="mt-4 flex flex-wrap gap-2">
          {entity.aliases.map((a) => (
            <li key={a.id}>
              <form action={removeEntityAlias.bind(null, a.id)}>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-navy-50 py-1 pl-2.5 pr-1.5 text-[12.5px] text-navy-900">
                  {a.aliasText}
                  {a.source !== 'NAME' && (
                    <span className="text-[10px] uppercase tracking-wide text-subtle">
                      {a.source.replace('_', ' ')}
                    </span>
                  )}
                  <button
                    className="grid size-4 place-items-center rounded-full text-subtle transition-colors hover:bg-danger-100 hover:text-danger-700"
                    aria-label={`Remove alias ${a.aliasText}`}
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </span>
              </form>
            </li>
          ))}
          {entity.aliases.length === 0 && (
            <li className="text-[13px] text-subtle">No aliases yet.</li>
          )}
        </ul>

        <form action={addEntityAlias.bind(null, entity.id)} className="mt-4 flex flex-wrap gap-2">
          <input
            name="aliasText"
            required
            placeholder="As it appears on the document"
            className={`${INPUT} min-w-56 flex-1`}
          />
          <select name="source" defaultValue="NAME" className={`${INPUT} w-36 flex-none`}>
            {ALIAS_SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <button className={BTN.secondary}>Add alias</button>
        </form>
      </section>

      {/* --- the entity itself ---------------------------------------------- */}
      <form
        action={saveEntityDetail}
        className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(18,40,74,0.05)]"
      >
        <input type="hidden" name="id" value={entity.id} />
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.09em] text-navy-900">
          Details
        </h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Code" hint="Short code used in filenames">
            <input name="code" defaultValue={entity.code} required className={INPUT} />
          </Field>
          <Field label="Legal name">
            <input name="legalName" defaultValue={entity.legalName} required className={INPUT} />
          </Field>
          <Field label="EIN" hint="Matched when a notice shows only a tax ID">
            <input name="ein" defaultValue={ein} placeholder="12-3456789" className={INPUT} />
          </Field>
          <Field label="State" hint="Helps place state agency notices">
            <input name="state" defaultValue={state} placeholder="PA" className={INPUT} />
          </Field>
          <Field label="Sort order" hint="Also picks the badge colour">
            <input
              name="sortOrder"
              type="number"
              defaultValue={entity.sortOrder}
              className={INPUT}
            />
          </Field>
        </div>

        <label className="flex items-start gap-2 text-[13px]">
          <input
            type="checkbox"
            name="isSegregated"
            defaultChecked={entity.isSegregated}
            className="mt-0.5"
          />
          <span>
            Keep in its own tab
            <span className="block text-[12px] text-subtle">
              A display choice only — everyone can still see this entity and its documents.
            </span>
          </span>
        </label>

        <div className="flex items-center gap-3 border-t border-line-soft pt-4">
          <button className={BTN.primary}>Save changes</button>
          <span className="ml-auto" />
        </div>
      </form>

      <form action={toggleEntityActive.bind(null, entity.id, !entity.isActive)}>
        <button className="text-[12.5px] text-muted underline underline-offset-2 transition-colors hover:text-navy-700">
          {entity.isActive ? 'Deactivate this entity' : 'Reactivate this entity'}
        </button>
        <p className="mt-1 text-[12px] text-subtle">
          Entities are deactivated, never deleted — documents already filed against one
          have to keep resolving to it.
        </p>
      </form>
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] text-subtle">{hint}</span>}
    </label>
  )
}
