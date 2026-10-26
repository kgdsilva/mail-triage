import { UploadForm } from '@/components/upload-form'
import { PageHelp } from '@/components/page-help'
import { canTriage, requireUpload } from '@/server/session'

export const dynamic = 'force-dynamic'

export default async function UploadPage() {
  const session = await requireUpload()

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight text-navy-900">Upload a batch</h1>
        {/*
          Two versions, because "you can read them on Review later" is instructions to
          somebody who has a Review screen. The scanner does not, and telling her about a
          screen she cannot open is how a person decides the tool is not for them.
        */}
        <p className="mt-1 text-sm text-muted">
          {canTriage(session.role)
            ? 'One PDF per document, named however they arrive. Files are stored here — this platform is the source of truth, not Box or Drive. Nothing is read by the AI until you ask for it on Review, so you can drop a whole batch in first.'
            : 'One PDF per document, named however they arrive — no renaming, no sorting, no folders. Drop the whole scan in and you are done: the rest is picked up from here.'}
        </p>
        {/*
          Only for somebody who has the screens it mentions. The scanner's version of
          this page is deliberately four lines, and explaining Review to a person who
          cannot open Review is how they decide the tool is not for them.
        */}
        {canTriage(session.role) && (
          <div className="mt-2">
            <PageHelp topic="upload" />
          </div>
        )}
      </div>
      <UploadForm canClassify={canTriage(session.role)} />
    </div>
  )
}
