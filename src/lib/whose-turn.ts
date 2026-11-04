/**
 * Whose turn it is now, and where a thing just went.
 *
 * ---------------------------------------------------------------------------
 * Why one module for two questions
 * ---------------------------------------------------------------------------
 *
 * They are the same fact a second apart. "Approved — now with Chris to pay" is what the
 * screen says at the moment of the click; "With Chris to pay" is what the row says for
 * the days afterwards. Written in two places they drift, and a message that promises a
 * destination the rows never confirm is worse than no message: the person goes looking
 * for the bill where they were told it went, does not find it, and stops believing the
 * next sentence too.
 *
 * So the vocabulary is fixed here, once. A screen that wants to name a destination picks
 * from `wentTo`; a row that wants to name a holder calls `whoseTurn`; and both say the
 * same words about the same state.
 *
 * ---------------------------------------------------------------------------
 * Why names and not roles
 * ---------------------------------------------------------------------------
 *
 * "With the accountant" is already in the help text and nobody had to be told it. What
 * was missing was who that is today — the complaint was "I approved it, where does it
 * go?", which is a question about a person, not about a job title. So every label takes
 * a name and falls back to the role only when there genuinely is nobody: an office with
 * no accountant is a real state, and saying "with accounting" when the seat is empty is
 * how a bill waits on nobody for a month.
 */

export type TurnTone = 'you' | 'them' | 'office' | 'done' | 'nobody'

export type Turn = { label: string; tone: TurnTone }

export const TURN_TONE: Record<TurnTone, string> = {
  you: 'bg-gold-100 text-gold-800',
  them: 'bg-navy-50 text-navy-700',
  office: 'bg-amber-100 text-amber-800',
  done: 'bg-ok-100 text-ok-700',
  nobody: 'bg-danger-100 text-danger-700',
}

export type TurnState = {
  approvalStatus: 'PENDING' | 'APPROVED' | 'DENIED' | 'NEEDS_REVIEW' | null
  /** Paid. A settled bill has left every queue there is. */
  settled: boolean
  /** Whoever the document is assigned to right now, by name. */
  holder: string | null
  /** True when that holder is the person reading this screen. */
  isYou: boolean
  /** Who pays, for the stretch between approval and payment. */
  settler?: string | null
  /** True when that payer is the person reading this screen. */
  settlerIsYou?: boolean
  /** Somebody has written a reply to the question on this document. */
  answered?: boolean
  /** Who approves for this company, while it is waiting on them. */
  approver?: string | null
}

/**
 * One sentence fragment naming the person this is waiting on.
 *
 * The order of the branches is the order the states actually happen in, read backwards:
 * finished first, because "paid" outranks everything that led to it, and a bill that has
 * been paid and then denied by a stale click is still paid.
 */
export function whoseTurn(s: TurnState): Turn {
  if (s.settled) return { label: 'Paid — nothing left to do', tone: 'done' }

  switch (s.approvalStatus) {
    case 'APPROVED':
      // The accountant reads this same row on his own screen, where "with Chris to pay"
      // is a sentence about himself in the third person.
      return s.settlerIsYou
        ? { label: 'Approved — with you to pay', tone: 'you' }
        : { label: `Approved — with ${s.settler ?? 'accounting'} to pay`, tone: 'them' }

    case 'DENIED':
      // Not "done", even though the decision is. Somebody still has to tell the vendor,
      // file it, or fix whatever the refusal was about, and a green badge saying
      // "finished" is how a denial becomes nobody's job.
      return {
        label: `Denied — back with ${s.holder ?? 'the office'}`,
        tone: 'office',
      }

    case 'NEEDS_REVIEW':
      /*
       * The reply changes whose turn it is, and the chip was the last thing still
       * saying otherwise: "waiting on the office" stayed on a bill the office had
       * already answered, which is the one sentence on the row that would send the
       * approver away again.
       */
      if (s.answered) return { label: 'Answered — back with you', tone: 'you' }
      return s.isYou
        ? { label: 'Waiting on your answer', tone: 'you' }
        : { label: `Question asked — waiting on ${s.holder ?? 'the office'}`, tone: 'office' }

    case 'PENDING': {
      if (s.isYou) return { label: 'Waiting on you to approve', tone: 'you' }
      /*
       * The approver, and only the approver. Falling back to whoever the document is
       * assigned to produced "With Chris to approve" about the accountant, who is the
       * one person the separation of duties forbids from approving — on a bill for a
       * company that has no approver at all, which is the state the next line exists to
       * announce. An assignee is not a stand-in for an approver.
       */
      const approver = s.approver
      // "With the approver" when the company has none is the one lie this codebase goes
      // out of its way to refuse: `markNeedsPayment` will not create this state, and a
      // row that predates that rule still has to say what it is. A bill waiting on
      // nobody looks exactly like a bill waiting on somebody slow.
      return approver
        ? { label: `With ${approver} to approve`, tone: 'them' }
        : { label: 'Waiting on approval — no approver is assigned', tone: 'nobody' }
    }

    default:
      if (s.isYou) return { label: 'With you', tone: 'you' }
      if (s.holder) return { label: `With ${s.holder}`, tone: 'them' }
      // The one state worth a red badge: it is not late, it is unowned, and nothing
      // about a quiet row says so.
      return { label: 'With nobody yet — anyone can take it', tone: 'nobody' }
  }
}

/**
 * What to say the instant somebody acts.
 *
 * Each one names a destination and, where the destination is a screen, names the screen
 * — "under Approved" rather than "it has moved". Somebody who was told the tab can go
 * and look; somebody who was told it moved can only trust.
 */
/**
 * A list of people, as a sentence rather than a queue of names.
 *
 * Any one of them can clear the bill, so all of them are true — but "waiting on kg or
 * Megan or Eric or Eric Demo or Danny Demo" is a banner nobody finishes reading, and the
 * two names that matter are the first two.
 */
export function someoneOf(names: string[]): string {
  if (names.length === 0) return 'nobody yet'
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} or ${names[1]}`
  return `${names[0]}, ${names[1]} or ${names.length - 2} other${names.length - 2 === 1 ? '' : 's'}`
}

export const wentTo = {
  approved: (settler: string | null) =>
    `Approved — now with ${settler ?? 'accounting'} to pay. You will find it under Decided.`,

  denied: (returnee: string | null) =>
    `Denied — sent back to ${returnee ?? 'the office'}, with your reason. You will find it under Decided.`,

  asked: (returnee: string | null) =>
    `Question sent to ${returnee ?? 'the office'}. It stays on your list, under Your questions, until they answer.`,

  needsPayment: (approvers: string[]) =>
    `Sent to ${approvers.length ? someoneOf(approvers) : 'the approver'} to approve. It moves to Waiting on approval.`,

  notABill: 'Filed. Nothing is owed on it, and it stays findable in the Master log.',

  handed: (person: string) =>
    `Handed to ${person}. The question is on their own screen now — they answer it there, and it comes back to you here.`,

  answered: 'Answer saved on the document, where whoever asked will read it.',

  paid: 'Recorded. It moves to Paid, with the proof attached to the payment.',
} as const
