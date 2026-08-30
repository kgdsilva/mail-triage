/**
 * What the model is asked to return after reading a scan.
 *
 * Deliberately narrow: this is an *extraction* schema, not a decision schema. What the
 * document says is a reading task and belongs to the model; whether a bill is on
 * autopay is a database lookup and belongs to src/server/action-filter.ts. The two
 * judgements the filter cannot make from the database alone — is this a solicitation
 * disguised as a notice, does it carry a real deadline or risk — are asked for here,
 * with the evidence that supports them.
 */
export const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'entityCode',
    'addresseeName',
    'documentTypeCode',
    'vendorName',
    'amount',
    'documentDate',
    'dueDate',
    'summary',
    'moneyDirection',
    'solicitation',
    'deadlineOrRisk',
    'confidence',
  ],
  properties: {
    entityCode: {
      type: ['string', 'null'],
      description:
        'Entity code from the provided list whose name, address or EIN appears as the ADDRESSEE. Null if none of them clearly matches — do not guess from the sender.',
    },
    addresseeName: {
      type: ['string', 'null'],
      description:
        'The addressee exactly as printed, even when it matches none of the entities — a person, a different company, a former name. Null only when the page shows no addressee at all.',
    },
    moneyDirection: {
      type: 'string',
      enum: ['owed_by_us', 'received_by_us', 'neither'],
      description:
        'owed_by_us when the document asks for payment. received_by_us for a check or payment arriving. neither when no money moves.',
    },
    documentTypeCode: {
      type: ['string', 'null'],
      description: 'Document type code from the provided list. Null if none fits.',
    },
    vendorName: {
      type: ['string', 'null'],
      description:
        'Who SENT this — the biller, agency or company. Their name as printed, not an abbreviation. Null if unclear.',
    },
    amount: {
      type: ['number', 'null'],
      description:
        'Amount due, or the face value of an incoming check. Not the account balance or previous balance. Null if the document states no amount.',
    },
    documentDate: {
      type: ['string', 'null'],
      description: 'Date printed on the document, as YYYY-MM-DD. Null if absent.',
    },
    dueDate: {
      type: ['string', 'null'],
      description:
        'Date by which something must happen, as YYYY-MM-DD. Null if the document states no deadline.',
    },
    summary: {
      type: 'string',
      description:
        'One or two plain sentences telling a colleague what this is and what it wants. No preamble.',
    },
    solicitation: {
      type: 'object',
      additionalProperties: false,
      required: ['isSolicitation', 'disguisedAsOfficial', 'evidence'],
      description:
        'Advertising mail dressed up as an official notice or invoice. These self-disclose in fine print.',
      properties: {
        isSolicitation: { type: 'boolean' },
        disguisedAsOfficial: {
          type: 'boolean',
          description:
            'True only when it imitates a government or regulatory notice — official-looking letterhead, a threatened fine or penalty, an urgent deadline. Ordinary advertising that is plainly an advert is false here.',
        },
        evidence: {
          type: ['string', 'null'],
          description:
            'The fine-print disclaimer quoted verbatim — "this is not a bill", "not affiliated with any government agency", "this is a solicitation". Null when the page carries no such disclaimer. A marketing slogan or a call to action is not a disclaimer; do not quote one here.',
        },
      },
    },
    deadlineOrRisk: {
      type: 'object',
      additionalProperties: false,
      required: ['present', 'detail'],
      description:
        'A stated deadline, or a consequence: penalty, interest, collections, legal action, cancellation of coverage.',
      properties: {
        present: { type: 'boolean' },
        detail: { type: ['string', 'null'] },
      },
    },
    confidence: {
      type: 'number',
      description:
        '0 to 1, for the extraction as a whole. Low when the scan is poor or the document is unfamiliar.',
    },
  },
} as const

export type Extraction = {
  entityCode: string | null
  addresseeName: string | null
  moneyDirection: 'owed_by_us' | 'received_by_us' | 'neither'
  documentTypeCode: string | null
  vendorName: string | null
  amount: number | null
  documentDate: string | null
  dueDate: string | null
  summary: string
  solicitation: {
    isSolicitation: boolean
    disguisedAsOfficial: boolean
    evidence: string | null
  }
  deadlineOrRisk: { present: boolean; detail: string | null }
  confidence: number
}
