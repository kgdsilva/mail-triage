import { listAllForExport } from '@/server/documents'
import { parseFilters } from '@/lib/filters'
import { canSearchArchive, canSeeWholeLog, canWork, requireSession } from '@/server/session'
import { visibleEntityIds } from '@/server/scope'

const COLUMNS = [
  'Reviewed',
  'Batch',
  'Original filename',
  'Final filename',
  'Entity',
  'Type',
  'Vendor',
  'Document date',
  'Due date',
  'Amount',
  'Disposition',
  'Archive reason',
  'Status',
  'Assigned to',
  'Folder',
  'Note',
] as const

/** RFC 4180: quote everything, double any embedded quotes. */
function csvCell(value: unknown) {
  if (value === null || value === undefined) return '""'
  return `"${String(value).replace(/"/g, '""')}"`
}

function isoDate(d: Date | null) {
  return d ? d.toISOString().slice(0, 10) : ''
}

export async function GET(req: Request) {
  const session = await requireSession()
  // The scanner uploads and never reads back: no document, no receipt, no export.
  if (!canWork(session.role) && !canSearchArchive(session.role)) {
    return new Response('Not found', { status: 404 })
  }

  const filters = parseFilters(new URL(req.url).searchParams)

  // Exactly the restriction the log screen applies — an export that skipped it would be
  // the way around it, and a CSV is the easiest thing in the app to walk out with.
  const scope = await visibleEntityIds(session)
  if (scope !== null) filters.restrictToEntityIds = scope
  else if (!canSeeWholeLog(session.role)) filters.restrictToUserId = session.userId

  const rows = await listAllForExport(session.companyGroupId, filters)

  const lines = [COLUMNS.map(csvCell).join(',')]
  for (const r of rows) {
    lines.push(
      [
        isoDate(r.reviewedAt),
        r.batch?.label ?? '',
        r.originalFilename,
        r.finalFilename ?? '',
        r.entity?.code ?? '',
        r.documentType?.label ?? '',
        r.vendor?.name ?? '',
        isoDate(r.documentDate),
        isoDate(r.dueDate),
        r.amount ? r.amount.toString() : '',
        r.disposition,
        r.dispositionReason ?? '',
        r.status,
        r.assignedTo?.name ?? r.assignedTo?.email ?? '',
        r.storageFolder?.pathCache ?? '',
        r.summaryNote ?? '',
      ]
        .map(csvCell)
        .join(','),
    )
  }

  const stamp = new Date().toISOString().slice(0, 10)
  return new Response(
    // BOM so Excel opens the accented characters correctly on a double click.
    '﻿' + lines.join('\r\n'),
    {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="mail-log-${stamp}.csv"`,
      },
    },
  )
}
