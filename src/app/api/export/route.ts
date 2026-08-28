import { listAllForExport } from '@/server/documents'
import { parseFilters } from '@/lib/filters'
import { canSeeWholeLog, requireSession } from '@/server/session'

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
  const filters = parseFilters(new URL(req.url).searchParams)
  // Same restriction as the log screen — otherwise the export is a way around it.
  if (!canSeeWholeLog(session.role)) filters.restrictToUserId = session.userId

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
