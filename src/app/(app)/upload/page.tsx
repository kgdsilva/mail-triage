import { UploadForm } from '@/components/upload-form'

export const dynamic = 'force-dynamic'

export default function UploadPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Upload a batch</h1>
        <p className="mt-1 text-sm text-neutral-500">
          One PDF per document, named however they arrive. Files are stored here — this
          platform is the source of truth, not Box or Drive.
        </p>
      </div>
      <UploadForm />
    </div>
  )
}
