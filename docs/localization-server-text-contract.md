# Server-generated text: the contract localization needs

Written for: whoever designs the next server-side feature that produces text a
member reads, and whoever eventually schedules the migration this note argues
for.

This is an architecture note, not a plan of work. Nothing in it was migrated in
Wave A.5, and no existing data was touched.

---

## The problem, in one sentence

A sentence composed on the server cannot be translated on the client, because
by the time it arrives the words have already been chosen.

Everything else here follows from that.

---

## Where it bites today

Four waves of localization (A.1 to A.4) reached every string the client
composes. These are the ones that were left, each with the reason.

| Source | Example | Why it resists localization |
|---|---|---|
| Activity feed entries | `activity.note` rows | The row holds a finished English sentence written at the time of the event. |
| Risk assessment factors | `risk.factors[].label` and `.detail` | Composed by `loamy_bank_risk_assessment`. In a stored credit report they come from `report.snapshot`, which makes them HISTORICAL text. |
| Settlement readiness | `readiness.reason` | The server returns a sentence when it has no code to give. |
| Checklist definitions | `checklist_definition.item.label` | Rows an admin authored, in one language. |
| Edge function failures | Paystack and escrow function bodies | A message from a third party, relayed. |
| Postgres errors | `new row violates row-level security policy` | Not ours at all. |
| The downloadable purchase contract | `contractHtml()` | Deliberate, and different in kind: see below. |

### The one that is NOT a localization gap

`contractHtml()` generates the purchase contract two parties e-sign. It stays
English **on purpose**, and the same reasoning was applied again in A.4. A
signed instrument needs one authoritative reviewed text; generating a second
language version creates a second contractual document that nobody reviewed,
and the signature block records a typed name against "the terms above", which
has to be one fixed text.

The A.4 credit report went the other way, and the distinction is worth keeping
clear: a credit report is decision support, nobody signs it, it creates no
obligation, and its own footer says the decisions rest with the Bank. The test
is not "is this a document" but "does anybody's obligation depend on these
exact words".

---

## The contract to prefer: CODE + PARAMS

Where localization is required, a server should return **what happened**, not
**a sentence about what happened**.

```
-- today: the words are already chosen
{ "note": "Growth Partner Amina verified 3 bags at Kano warehouse" }

-- preferred: the client chooses the words
{ "code": "verification.completed",
  "params": { "partner": "Amina", "bags": 3, "place": "Kano warehouse" } }
```

The client then renders `t('activity.verification.completed', params)`, and the
same event reads correctly in all five languages without the server knowing any
of them.

### Why this shape and not the obvious alternatives

**Why not translate on the server?** It would need the member's locale at write
time, which is the wrong time: an activity row is written once and read by
different people, later, possibly in different languages. The locale belongs to
the read, not the write.

**Why not store all five languages?** Five columns that must stay in step, a
backfill every time a string changes, and no answer for the sixth language. The
whole point of a key is that the words are not the data.

**Why not a key with the sentence interpolated already?** That is the current
shape with extra steps. The params have to arrive separately or the client
cannot reorder them, and reordering is most of what translation is: Hausa does
not put the actor where English does.

### What the code must be

- **Stable.** It is now part of the API. Renaming `verification.completed`
  breaks every historical row that carries it.
- **Enumerated, not free text.** A code the client has never heard of renders
  as a fallback, so the set has to be knowable. `tOr(code, serverEnglish)` is
  the right client-side shape: pass the code AND the server's English, so an
  unrecognised code degrades to a readable sentence rather than to
  `activity.something_new`.
- **Accompanied by params that are DATA.** Names, quantities, places, dates.
  Never a pre-translated fragment, because a fragment cannot be reordered
  either.

---

## Migration, and why it is not a backfill

**Existing rows must not be rewritten.** An activity row is a record of what
was said at the time. Rewriting it to a code would be editing history, and in
the credit-report case it would alter a document a bank may have filed.

So the migration is additive and gradual:

1. **New writers emit both.** Add `code` and `params` columns, nullable. A new
   feature populates them and keeps writing the English sentence into the
   existing column.
2. **Readers prefer the code.** `tOr(row.code, row.note)` renders the
   translated form where a code exists and the historical sentence where it
   does not. No row needs changing for the new path to start working.
3. **The old column stops being written** once every writer emits a code. It
   is kept, because the rows that only have it are still the truth about what
   was said.
4. **Nothing is backfilled.** A row written before the code existed renders its
   English forever, and that is correct: it is what the system said.

The cost of this shape is that the two columns coexist for a long time. The
benefit is that no step of it can lose or alter a record.

---

## What a reviewer should insist on in new server work

- A member-facing string composed in SQL or in an edge function is a design
  decision, not an implementation detail. It should be a code.
- A status, state, flag or event type is already a code. Return it rather than
  a sentence about it; the client has had `tOr(\`namespace.${value}\`, english)`
  since Wave A.3 and it is how every status in the product already renders.
- A sentence that does legal or safety work (who holds funds, who decided, what
  a signature means) is listed in `src/lib/i18n/glossary.md` and must survive
  whole. If the server composes one of those, the words matter more than the
  convenience, and the code-and-params shape is what preserves them.

---

## Status

Nothing here is implemented. The classes of text are enumerated so the next
server feature can avoid adding to them, and so the eventual migration has a
shape to follow rather than being designed under pressure.
