/**
 * What each screen is for, in one place.
 *
 * ---------------------------------------------------------------------------
 * Why a module and not a sentence next to each title
 * ---------------------------------------------------------------------------
 *
 * Because the same explanation now exists in two artefacts — the platform guide people
 * are sent once, and the help on the screen they read while working — and two copies of
 * a truth drift. Every bug worth finding in this project this week was two things that
 * were supposed to agree and quietly stopped: a count beside the list it labelled, a
 * filter copied between two queries, a comment promising a duplicate matched.
 *
 * The guide cannot read this file, so the copies are not technically one. But they are
 * one *here*: change a screen's job and this is the single place in the app that has to
 * change with it, and the guide's matching section is named below so the person editing
 * knows what else to go and fix.
 *
 * ---------------------------------------------------------------------------
 * What belongs in one of these
 * ---------------------------------------------------------------------------
 *
 * What to do on this screen, who it is for, and the one thing people get wrong. Not a
 * feature list: the buttons are already on the page and labelled. Somebody opens this
 * because the screen did not explain itself, so the answer is the sentence the screen
 * was missing, not the screen again in prose.
 */

export type Help = {
  /** A plain question, as the person would ask it. */
  title: string
  /** Two to four short paragraphs. */
  body: string[]
}

export const HELP: Record<string, Help> = {
  board: {
    title: 'What is this screen for?',
    body: [
      'Everything that needs a person and is not a payment: a form to return, a dispute to answer, a document nobody could match to a company. Bills live on their own screens.',
      '“Nobody yet” is the one to watch. Those items are waiting on no one, and anybody can pick one up — an empty “Mine” with a full “Nobody yet” means the office has work and nobody has claimed it.',
      'A bill an approver denied or sent back comes here, because it needs somebody in the office again.',
    ],
  },

  approvals: {
    title: 'What am I deciding here?',
    body: [
      'Every bill waiting on you, for the companies assigned to you. You are clearing it for payment, not paying it — the accountant pays and records it afterwards.',
      'The three totals at the top say what to open first: overdue, due this week, waiting in total. Bills are grouped the same way.',
      'Approve clears it. Deny means do not pay, and your reason is kept and shown to the accountant. Send back is a question rather than a decision — it returns to the office with your note and can come round again.',
      'Preview opens the invoice. Approving without opening it is possible, and recorded as such.',
    ],
  },

  'accounting.decide': {
    title: 'What is this queue?',
    body: [
      'Money that nobody has ruled on yet. The reader thinks each of these involves money; you decide what it actually is.',
      'Needs payment sends it to the approver for that company. If that company has no approver assigned, the button refuses and says so — a bill waiting on nobody is the failure this whole workflow exists to prevent.',
      'Not a bill is for a statement, a notice with nothing owed, a confirmation. Needs other action is for real work that is not a payment: a form to return, a dispute. Hand that to a person by name.',
    ],
  },

  'accounting.ready': {
    title: 'What do I do here?',
    body: [
      'Everything an approver has cleared and nobody has settled yet. Each row shows who approved it and when.',
      'Make the payment in QuickBooks, then record it here: the amount, the date the money actually left, how it was paid, and the cheque number or reference. The date is the day the money moved, not the day you typed it in.',
      'Attach the receipt to the payment. It stays on the payment rather than becoming another document, so a proof of payment never turns up in the triage queue asking to be classified.',
    ],
  },

  'accounting.waiting': {
    title: 'Why can I not act on these?',
    body: [
      'These are waiting on an approver, not on you. The screen is read-only on purpose: approving and paying are deliberately different people.',
      'It is here so you can see what to chase and who to chase. A bill that was sent back shows the note that came with it, which is usually the answer to “why is this still here”.',
    ],
  },

  'accounting.denied': {
    title: 'What is a denied bill doing here?',
    body: [
      'An approver decided not to pay it, and said why. It sits next to Ready to pay on purpose: what to pay and what not to pay are the same question, and a refusal that disappeared would look exactly like a bill nobody had decided yet.',
      'Nothing is owed on these. They stay visible so the reason is findable later.',
    ],
  },

  'accounting.paid': {
    title: 'What is in here?',
    body: [
      'What has gone out, with who recorded it and the proof if one was attached. History, not a queue.',
      'Use the company filter and Export CSV in the log when somebody asks what a company paid over a period.',
    ],
  },

  'accounting.checks': {
    title: 'Why are cheques separate?',
    body: [
      'These are cheques this office received — money coming in. They carry no spend category and need no approval, which is why they are kept out of every other queue.',
      'They are here to be seen and banked, not decided.',
    ],
  },

  review: {
    title: 'What happens on this screen?',
    body: [
      'This is where the AI reads. Nothing is read automatically: a batch of scans sits costing nothing until somebody presses Read, and the price is shown before the click.',
      'For each document the reader proposes what it is and what to do — Pay, Archive or Spam — and a person confirms or overrides. Where it is unsure it says so instead of guessing.',
      '“Needs a look” is what has no decision yet. “Not filed” is decided but has no final name or folder, so it was never actually filed — open one to finish it.',
    ],
  },

  upload: {
    title: 'How should I upload?',
    body: [
      'One PDF per document, named however they come off the scanner. Drop a whole batch at once; the batch label is just so you can find them together later.',
      'Nothing is read by the AI here, so uploading costs nothing. The reading happens on Review, when somebody asks for it.',
      'An invoice that arrived by email does not need to be scanned — forward it instead, or use “Add a bill” if all you have is a web page.',
    ],
  },

  log: {
    title: 'What can I find here?',
    body: [
      'Every document that has ever passed through, including the removed ones. Nothing is deleted — removing hides it and keeps it.',
      'Type and category answer different questions. The type is what the paper is: Bill, Tax Notice, Check. The category is what the money was for: Taxes, Payroll, Insurance. Both are true of the same document.',
      'The category column is editable in place. Filter to a category, see what does not belong, and fix it in the row — a correction by hand is final and no automatic pass overwrites it.',
      'Export CSV gives you whatever the filters are currently showing.',
    ],
  },
}
