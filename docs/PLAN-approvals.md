# Invoice approval, accountant view, archive search — plan

Written before any code was changed, per the brief. What exists, what gets extended, and
what gets added.

## What already exists (and is being built on, not replaced)

**Data.** `Document` is the master-log row: entity, documentType, vendor, amount,
dueDate, `disposition` (UNREVIEWED / ARCHIVE / ACTION), `status` (WAITING / IN_PROGRESS /
DONE / ARCHIVED / VOID), `actionKind` (PAY / CONFIRM / REVIEW), `assignedToUserId`,
storage columns, soft delete only. `DocumentEvent` is already an append-only trail that
every write path records to. `Payment` already records a paid bill with its receipt
(amount, paidOn, method, note, receipt columns, recordedBy), deliberately separate from
Document so a receipt never enters triage. `Entity` has `isSegregated`, which is what
keeps OP in its own view. `Membership` already has **`entityScope String[]`** — declared
for exactly this purpose and never used by any code.

**Screens.** Upload a batch, Review (AI sweep + one-click Pay/Archive/Spam), Needs a
decision (the shared board), Bills to pay, Bills paid, Checks received, Master log
(entity → type → list drill-down, full-text + trigram search, CSV export), Settings
(entities, document types, vendors, autopay, members).

**Permissions.** `canConfigure` / `canTriage` / `canUpload` / `canWork` / `canDecide` /
`canSeeWholeLog` in `src/server/session.ts`, all positive lists. Roles today: OWNER,
ADMIN, OPERATOR, MEMBER, UPLOADER, VIEWER.

**Reusable pieces.** `PdfFrame`/`PeekToggle` (inline preview), `/api/files/[id]` (serves
a PDF by document id so the tenant check precedes the bytes), `/api/receipts/[id]`,
`PaymentForm`, `CompanyPicker`, `LogFilters`, `BTN`/`entityColor` theme tokens.

## What is added

| Area | Approach |
|---|---|
| Roles | Add `APPROVER` and `ACCOUNTANT` to the existing enum; add `canApprove`, `canSettlePayments`, `visibleEntityIds` beside the existing predicates |
| Per-entity scope | Use the existing `Membership.entityScope`, storing entity ids. Empty = every entity. Enforced in one place and applied last, so no query string can widen it |
| OP | Non-admin roles never see a segregated entity. One rule, not a name |
| Approval state | `Document.approvalStatus` (PENDING / APPROVED / DENIED / NEEDS_REVIEW) + `approvalNote`, `approvalDecidedBy`, `approvalDecidedAt`. Set to PENDING by the single existing decision path whenever a document becomes a PAY action |
| Invoice number | `Document.invoiceNumber`, searchable |
| Category | New per-group editable `Category` list + `Document.categoryId`. Separate axis from documentType: "Bill" is what the mail *is*, "Technology" is what the spend *is* |
| Bills to Approve | New `/approvals` |
| Accountant view | New `/accounting` with three tabs, reusing `PaymentForm` and the receipt path |
| Archive search | Extend `LogFilters` + `parseFilters` + `buildWhere` with vendor, amount range and category; invoice number joins the free-text match |
| History | New panel reading `DocumentEvent`, plus a database trigger that refuses UPDATE and DELETE on it |
| Demo data | `Document.isDemo` flag, a seed script and a one-command purge |

## Order

Priority 1 first and complete: schema → permissions → approvals page → accountant view →
history → archive search → settings screens → demo seed → typecheck/lint/build.
Then priority 2 (naming, vendor aliases, storage/backup report), then priority 3.

## Decisions taken without asking (also in the final report)

1. **`entityScope` holds entity ids, and empty means every entity.** The schema comment
   said "null = every entity", which a Prisma scalar list cannot be.
2. **A denied or needs-review bill is assigned to the group's OWNER**, not to a named
   person, and appears on Needs a decision with the note. The brief says "back to KG";
   hardcoding a name was ruled out by the same brief.
3. **Category is a new list, not the existing document types.** Technology / Marketing /
   Office-Rent are not kinds of mail, and overloading documentType would break the filing
   rules and the review defaults that already key off it.
4. **Payment method becomes a fixed list in the form** (Check, ACH, Credit card, Other)
   with a new `reference` column, while the column stays free text so the payments
   already recorded keep displaying.
