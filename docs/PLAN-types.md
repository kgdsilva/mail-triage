# Splitting Type and Category

**Status:** proposal. Nothing has been changed.
**Decision needed from:** Eric and Chris, on the two lists in §3.
**Counts measured:** 23 October 2026, against a copy of production (459 live documents).

---

## 1. What this fixes

Eric, in the October meeting:

> "Instead of calling that column insurance, you call it *type* … like a letter, an
> invoice, a check. And then you have another column that says *category*, and that's
> where it could be insurance, legal, rent, utilities."

> "We could just say, okay, show me all the invoices. And then we could say, show me all
> the invoices for insurance."

And the reason it matters, from the same meeting: Kenzie uploads everything, so the log
carries a great deal that is not a bill, and there is no way to ask for only the bills.

The platform already has both fields — `documentTypeId` and `categoryId` are separate
columns, and the Master log can filter on either. **No structure is missing.** What is
wrong is the content: the seeded type list mixes the two ideas, so `INSURANCE` and
`PAYROLL` sit in the list as though they were kinds of document.

---

## 2. What is in the log today

| Current type | Documents | Is it really a type? |
|---|---:|---|
| `CHECK` — Check (incoming) | 142 | yes |
| *(no type at all)* | 90 | — |
| `OTHER` — Other | 40 | yes |
| `IRS_NOTICE` — IRS Notice | 38 | it is a notice **about tax** |
| `STATEMENT` — Statement | 37 | yes |
| `BILL` — Bill | 35 | yes |
| `TAX_NOTICE` — Tax Notice | 28 | it is a notice **about tax** |
| `INSURANCE` — Insurance | 28 | **no — this is a category** |
| `SPAM` — Spam / Solicitation | 8 | it is a *reason*, not a kind |
| `PAYROLL` — Payroll (W2/1099) | 8 | **no — this is a category** |
| `TAX_PR_NOTICE` — Tax / PR Notice | 5 | it is a notice **about tax** |
| **Total** | **459** | |

And the part that decides the shape of this plan:

```
documents with a category : 0   of 459
documents with a vendor   : 20  of 459
```

Seven categories exist — Insurance, Legal, Marketing, Office/Rent, Other, Technology,
Utilities — and **not one document uses any of them**. They were created and never
filled.

---

## 3. The two lists, for Eric and Chris to approve

### Type — what kind of document it is

| Code | Label |
|---|---|
| `INVOICE` | Invoice |
| `CHECK` | Check received |
| `NOTICE` | Letter or notice |
| `STATEMENT` | Statement |
| `OTHER` | Other |

Eric's list exactly. Five is the right number: a type whose members are never asked for
separately is a type nobody will use.

### Category — what it is about

Insurance · Legal · Marketing · Office/Rent · Technology · Utilities · **Tax** ·
**Payroll** · Other

The first seven exist already. **Tax** and **Payroll** are new, and they are needed:
76 documents are tax notices and 8 are payroll, and without those two categories the
largest group in the log would land in "Other".

---

## 4. The mapping, with what each line touches

| Today | n | New type | New category | Certainty |
|---|---:|---|---|---|
| `BILL` | 35 | `INVOICE` | *(left empty)* | certain |
| `CHECK` | 142 | `CHECK` | *(none — money in)* | certain |
| `IRS_NOTICE` | 38 | `NOTICE` | **Tax** | certain |
| `TAX_NOTICE` | 28 | `NOTICE` | **Tax** | certain |
| `TAX_PR_NOTICE` | 5 | `NOTICE` | **Tax** | certain |
| `STATEMENT` | 37 | `STATEMENT` | *(left empty)* | certain |
| `PAYROLL` | 8 | `NOTICE` | **Payroll** | certain |
| `SPAM` | 8 | `OTHER` | *(none)* | see §5 |
| `OTHER` | 40 | `OTHER` | *(left empty)* | certain |
| `INSURANCE` | 28 | **unchanged** | **Insurance** | see §5 |
| *(no type)* | 90 | **unchanged** | *(left empty)* | see §5 |

**Documents whose type changes: 122.** Documents that gain a category: **107**
(76 Tax, 8 Payroll, 28 Insurance — the last gaining only the category).

Everything else keeps the type it has.

---

## 5. The three cases that are not deterministic

These are where a migration would have to guess, so it does not.

**`INSURANCE`, 28 documents.** Insurance is certainly the *category*. What *type* each
one is — a premium invoice, a policy statement, a letter about a claim — cannot be read
off the old type. The plan sets the category and leaves the type alone, so they are
findable as "insurance" immediately and can be typed afterwards.

**No type at all, 90 documents.** These arrived through the historical import without a
type in the spreadsheet. Nothing can be inferred; they are left alone.

**`SPAM`, 8 documents.** Spam is not a kind of document, it is a judgement about one —
and the platform already records it properly, as the archive reason
`SPAM_SOLICITATION`. Mapping the type to `OTHER` loses nothing: the Master log can still
list them by reason. **If Eric would rather keep a visible Spam type, say so** — it is
one line in the mapping.

---

## 6. Filling the categories — a separate, bigger job

The mapping above fills 107 categories because they follow from the old type. The other
352 do not, and **nothing in the platform can fill them today**:

- the vendor could imply a category, but only **20 documents have a vendor**;
- the reader could return one, but it does not — the extraction schema has no category
  field, and `suggest.ts` sets `categoryName: null` outright.

So there are two phases, and the first is worth doing alone.

**Phase A — Type.** Deterministic, reversible, no AI, no cost. Delivers the first half of
what Eric asked for: *show me all the invoices*.

**Phase B — Category.** Teach the reader to return a category from the agreed list, then
re-read the 435 documents that have a file. Measured cost of a read here: half a cent
each, so **about $3 for the backlog**, and every document that arrives afterwards is
categorised on the way in. Delivers the second half: *invoices for insurance*.

Phase B should wait for the list in §3 to be approved, because the reader has to be told
the same list.

---

## 7. How it runs

1. **Create the two new categories** (Tax, Payroll) and the five types. Additive — the
   five new types are created alongside the old ones.
2. **Remap the 164 documents**, one `UPDATE` per mapping line, inside one transaction.
3. **Deactivate the old types** that are no longer used: `BILL`, `IRS_NOTICE`,
   `TAX_NOTICE`, `TAX_PR_NOTICE`, `PAYROLL`, `SPAM`, and `INSURANCE` once its documents
   have been typed. `isActive = false` — **never deleted**, because 459 documents point
   at them and a deleted type takes its history with it.
4. The old types stop appearing in the dropdowns and keep working everywhere a document
   still references them.

Run order, as agreed:

- **first** on the demo branch, with the before/after counts printed;
- **then** a fresh Neon backup branch, taken by KG;
- **then** production, and only after Eric and Chris have approved §3.

---

## 8. How to undo

Every document's old type is recorded in two places before anything changes:

1. **A `reclassified` event per document**, carrying the old and new type — the same
   append-only history every other change writes, and the database refuses to alter it.
2. **A reversal script**, generated from those events, that puts each document back on
   the type it had. The old types are still there and still work, because step 3 only
   deactivates them.

So the undo is one script, and it needs no backup to work. The backup in §7 is for the
case this plan has not thought of.

**What cannot be undone:** nothing. No type is deleted, no document is deleted, no
reason or decision is touched. The only columns written are `document_type_id` and
`category_id`.

---

## 9. What is not in this plan

- The default view for Chris and Eric being invoices only. It depends on the type
  existing first, and it is a one-line filter default afterwards.
- Teaching the reader about categories (Phase B).
- Anything about amounts, approvals or payments. This plan moves two labels and
  nothing else.
