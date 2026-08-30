import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/server/db/client'
import { getObject } from '@/server/storage'
import { EXTRACTION_SCHEMA, type Extraction } from '@/server/ai/schema'

/**
 * Reads a scanned document with Claude and returns what it says.
 *
 * This replaces the reading a person would otherwise do, not the decision they make.
 * Nothing here writes a classification: the result is stored as a suggestion on the
 * document and every field arrives on the classify screen pre-filled and editable.
 *
 * Claude reads PDFs natively, including poor scans, so there is no OCR step.
 */

const MODEL = 'claude-opus-5'

/** Anything larger than this is almost certainly a mis-scan, and costs real money to read. */
const MAX_READABLE_BYTES = 25 * 1024 * 1024

export function aiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim())
}

export type ReadResult =
  | { ok: true; extraction: Extraction; usage: { input: number; output: number } }
  | { ok: false; error: string }

/**
 * The group's own vocabulary, handed to the model so it matches against the real
 * entities and types rather than inventing labels. Aliases matter most: a scan says
 * "Marsh & Munar Team LLC" or shows an EIN, not "MMT".
 */
async function groupContext(companyGroupId: string) {
  const [entities, types] = await Promise.all([
    prisma.entity.findMany({
      where: { companyGroupId, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { code: true, legalName: true, metadata: true, aliases: { select: { aliasText: true } } },
    }),
    prisma.documentType.findMany({
      where: { companyGroupId, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { code: true, label: true },
    }),
  ])

  const entityLines = entities.map((e) => {
    const aliases = e.aliases.map((a) => a.aliasText)
    const meta = e.metadata as Record<string, unknown> | null
    const ein = typeof meta?.ein === 'string' ? ` EIN ${meta.ein}` : ''
    const also = aliases.length ? ` (also: ${aliases.join('; ')})` : ''
    return `- ${e.code} = ${e.legalName}${also}${ein}`
  })

  const typeLines = types.map((t) => `- ${t.code} = ${t.label}`)
  return { entityLines: entityLines.join('\n'), typeLines: typeLines.join('\n') }
}

function systemPrompt(entityLines: string, typeLines: string) {
  return `You read scanned business mail for a group of related companies and report what each document says.

Entities in this group. Match on the ADDRESSEE — who the mail is written to — never on the sender:
${entityLines}

Document types:
${typeLines}

How to read these:

Amount means what is owed now, or the face value of an incoming check. Statements often show a previous balance, a payment received and a new balance; report the amount actually due. If the document asks for nothing, the amount is null.

Due date means a date by which something must happen. A statement period ending, a printed date, or an "as of" date is not a due date.

Solicitations are advertising dressed as official mail: labor-law poster sellers, LLC compliance and "certificate of good standing" resellers, business filing centres. They imitate government letterhead, quote large fines, and print a disclaimer in small type — "this is not a bill", "not affiliated with any government agency", "this is a solicitation". That disclaimer is the tell. Quote it, and only it, as evidence. An official notice from a real tax authority never carries one.

Ordinary advertising is not this. A vendor's contact card, a rate sheet, a flyer from a supplier the company already deals with — these are plainly adverts and make no pretence of being official. Mark them as not disguised, and quote nothing: a slogan or an invitation to call is not a disclaimer.

Report a deadline or risk only for an obligation this company has to meet: a payment it owes, a response a government agency requires, coverage that lapses if it does nothing. A note on money arriving — "void if not deposited within 90 days", "deposit promptly" — is not one of those. Nothing is owed and nobody is at risk, so report no deadline.

Always name the addressee, even when it matches none of the entities above. Mail addressed to a person, or to a company not on the list, is a real and useful answer — report the name as printed and leave the entity code null. Never stretch an unfamiliar addressee onto the nearest entity.

Two things to be strict about. Report only what the document actually says; a null is more useful than a guess, and a wrong amount or date costs more than a blank field. And say nothing about whether a bill is on autopay — you cannot know that, and it is decided elsewhere from the company's own records.`
}

export async function readDocument(
  companyGroupId: string,
  documentId: string,
): Promise<ReadResult> {
  if (!aiConfigured()) return { ok: false, error: 'ANTHROPIC_API_KEY is not set' }

  const doc = await prisma.document.findFirst({
    where: { id: documentId, companyGroupId, deletedAt: null },
    select: { storageKey: true, storageBucket: true, mimeType: true, byteSize: true, originalFilename: true },
  })
  if (!doc?.storageKey) return { ok: false, error: 'No file attached to this record' }
  if ((doc.byteSize ?? 0) > MAX_READABLE_BYTES) return { ok: false, error: 'File too large to read' }

  let bytes: Buffer
  try {
    bytes = await getObject(doc.storageKey, doc.storageBucket)
  } catch {
    return { ok: false, error: 'Could not read the stored file' }
  }

  const { entityLines, typeLines } = await groupContext(companyGroupId)
  const isPdf = (doc.mimeType ?? 'application/pdf') === 'application/pdf'
  const client = new Anthropic()

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      thinking: { type: 'adaptive' },
      // Reading a form and pulling fields off it is not a hard reasoning problem, and
      // this runs once per document across hundreds of them.
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: EXTRACTION_SCHEMA },
      },
      system: [
        {
          type: 'text',
          text: systemPrompt(entityLines, typeLines),
          // Identical for every document in the group, so it is read from cache after
          // the first call rather than paid for on all of them.
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: [
            isPdf
              ? {
                  type: 'document',
                  source: {
                    type: 'base64',
                    media_type: 'application/pdf',
                    data: bytes.toString('base64'),
                  },
                }
              : {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: (doc.mimeType ?? 'image/jpeg') as 'image/jpeg',
                    data: bytes.toString('base64'),
                  },
                },
            {
              type: 'text',
              text: `Read this document and report what it says. The scan arrived named "${doc.originalFilename}" — that name is informal and often wrong, so use it only as a weak hint and let the page itself decide.`,
            },
          ],
        },
      ],
    })

    if (response.stop_reason === 'refusal') {
      return { ok: false, error: 'The model declined to read this document' }
    }

    const text = response.content.find((b) => b.type === 'text')
    if (!text || text.type !== 'text') return { ok: false, error: 'No readable response' }

    return {
      ok: true,
      extraction: JSON.parse(text.text) as Extraction,
      usage: {
        input: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0),
        output: response.usage.output_tokens,
      },
    }
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return { ok: false, error: 'ANTHROPIC_API_KEY was rejected' }
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { ok: false, error: 'Rate limited — try again shortly' }
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Reading failed' }
  }
}
