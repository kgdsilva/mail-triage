/**
 * The cheque number or transaction reference recorded against a payment.
 *
 * ---------------------------------------------------------------------------
 * Why this is checked and not merely labelled
 * ---------------------------------------------------------------------------
 *
 * The form offers "Credit card" as a way a bill was paid and then asks for a "check or
 * reference no.". An approver read those two together exactly as they are written and
 * typed the number of the card the bill had been paid with — which is the one value this
 * system must never hold. He was not doing anything unreasonable: the field asked for a
 * number and he had a number.
 *
 * A clearer label would make that less likely and is worth writing, but a label is
 * advice. Nobody should be able to put a card number in this database by reading the
 * screen in good faith, so the refusal lives on the write path, where it is a guarantee.
 *
 * What this is not: validation of a correct reference. Anything short, or with letters,
 * or with a vendor's own punctuation, passes untouched — the office writes down what the
 * bank gave them, and this has no opinion about that.
 */

/** Digits only, so spaces and dashes in a typed card number do not slip past. */
const digitsOf = (value: string) => value.replace(/\D/g, '')

/**
 * The checksum every card network's numbers satisfy. Checking it rather than the length
 * alone is what keeps a long cheque number or a bank's own 16-digit reference from being
 * refused: those fail Luhn, and a real card number cannot.
 */
function passesLuhn(digits: string): boolean {
  let sum = 0
  let double = false

  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i])
    if (double) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
    double = !double
  }

  return sum % 10 === 0
}

/** True when a value looks like a payment card number rather than a reference. */
export function looksLikeCardNumber(value: string): boolean {
  const digits = digitsOf(value)
  // The range every major network issues within. Below 13 a Luhn pass is coincidence.
  if (digits.length < 13 || digits.length > 19) return false
  return passesLuhn(digits)
}

export const CARD_NUMBER_REFUSED =
  'That looks like a full card number, which is never stored here. ' +
  'Use the last four digits, or the authorisation code from the statement.'
