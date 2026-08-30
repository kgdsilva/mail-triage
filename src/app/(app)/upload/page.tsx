import { UploadForm } from '@/components/upload-form'
import { requireTriage } from '@/server/session'

export const dynamic = 'force-dynamic'

export default async function UploadPage() {
  await requireTriage()

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight text-navy-900">Upload a batch</h1>
        <p className="mt-1 text-sm text-muted">
          One PDF per document, named however they arrive. Files are stored here — this
          platform is the source of truth, not Box or Drive. Nothing is read by the AI
          until you ask for it on Review, so you can drop a whole batch in first.
        </p>
      </div>
      <UploadForm />
    </div>
  )
}
