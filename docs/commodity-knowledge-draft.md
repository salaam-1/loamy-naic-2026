# DRAFT — NOT REVIEWED — NOT EVIDENCE — NOT WIRED INTO LOAM

**Nothing in this document is authoritative.** No statement here has been
checked by an agronomist. None of it is loaded by Loam, none of it reaches
N-ATLaS, and none of it is stored in `copilot_concepts`, `content_entries` or
the knowledge pack. It is a worksheet, written so a domain owner can correct,
approve, reject or replace each entry quickly.

Until a named reviewer signs off, "What is rice?" continues to decline. That is
the intended behaviour, not a bug.

---

## Why this document exists

Loam declines ordinary questions — "what is rice?", "what is maize?", "tell me
about sorghum" — because **no reviewed commodity content exists anywhere**:

| Source | Rows | Holds |
| --- | --- | --- |
| `content_entries` | **0** staging, **0** production | the designed home for `faq`/`notice`/`page` — empty in both |
| `copilot_concepts` | 4 | Digital ID, Verification, Murabaha, Escrow — platform and finance only |
| `commodity_varieties` | 31 | variety names and Hausa local names — real, but not definitions |
| Loam knowledge pack | 5 | maize planting, cycle length, rotation, storage — all `pending_agronomist_review` |

The gap is **content, not code**. `retrieveConcept` already matches
`copilot_concepts.aliases` and `conceptEvidence` already serves it as Level 2,
so a single approved row would make "what is rice?" answer with no new code.

## The attribution problem a reviewer should know about

`conceptEvidence` labels everything it serves `source: 'Loamy platform guide'`.
That is correct for Escrow and Murabaha — Loamy *is* the authority on its own
escrow. It would be **wrong for rice**: it would assert platform authority over
agronomy Loamy does not have, and would route agronomic claims around the
`pending_agronomist_review` discipline the knowledge pack carries deliberately.

So approving this content is necessary but not sufficient. The reader must also
carry a review status and an attribution that distinguishes an agronomic claim
from a platform claim, the way `sourceFor()` already does.

## Deliberate scope limit

Each entry below is **what the crop is and what it is used for** — nothing
more. Planting windows, spacing, yields, input rates and disease management are
**deliberately excluded**. Those are consequential, place-specific and belong
in the knowledge pack with its existing review process, not in a definitional
answer.

## A naming mismatch worth resolving first

The listing taxonomy and `commodity_varieties` do not use the same names:

- `commodity_varieties` says **Groundnuts**, the taxonomy says **Groundnut**
- `commodity_varieties` says **Pepper**, the taxonomy says **Chili Pepper**
- `commodity_varieties` has **Bambara, Okra, Onion, Tiger Nut, Tomato, Wheat**,
  which are **not** in the listing taxonomy
- No variety rows exist for **Sorghum, Sesame, Yam, Cocoa, Cashew, Ginger,
  Hibiscus**

Whoever builds the reader needs one canonical commodity vocabulary. Flagging it
here because it will otherwise surface as "why does maize work and yam not?".

---

## How to review

For each entry: tick one decision, and edit the DRAFT text in place.

`[ ] approve as written  [ ] approve with my edits  [ ] reject  [ ] replace`

**SOURCED** lines are real data read from `commodity_varieties` on 2026-10-08.
They are not my writing. **DRAFT** lines are mine and are unverified.

---

### 1. Maize
- **SOURCED varieties:** White maize (*Farar masara*), Kabomo maize (*Kabomo*), Red maize (*Jar masara*)
- **DRAFT:** A cereal grain grown across most of Nigeria, used for household food, for animal feed, and as a raw material for processing. One of the most widely traded staples on Loamy.
- `[ ] approve  [ ] edit  [ ] reject  [ ] replace` — notes:

### 2. Rice
- **SOURCED varieties:** Jamila, Faro, Yar Yarima, Dakuma, Tuwo, Samfarera
- **DRAFT:** A cereal grain grown both in lowland and upland systems in Nigeria, milled before sale or consumption, and a staple food nationally.
- `[ ] approve  [ ] edit  [ ] reject  [ ] replace` — notes:

### 3. Sorghum
- **SOURCED varieties:** none recorded
- **DRAFT:** A drought-tolerant cereal grown mainly in northern Nigeria, used for food, for brewing, and for animal feed.
- `[ ] approve  [ ] edit  [ ] reject  [ ] replace` — notes:

### 4. Millet
- **SOURCED varieties:** Dauro millet (*Dauro*), Gero millet (*Gero*)
- **DRAFT:** A hardy cereal suited to low-rainfall areas of northern Nigeria, used mainly for household food.
- `[ ] approve  [ ] edit  [ ] reject  [ ] replace` — notes:

### 5. Soybeans
- **SOURCED varieties:** Dan Bulagi soybeans (*Dan Bulagi*)
- **DRAFT:** An oilseed legume used for oil, for processed foods, and for animal feed. As a legume it is commonly grown in rotation with cereals.
- `[ ] approve  [ ] edit  [ ] reject  [ ] replace` — notes:

### 6. Cowpea
- **SOURCED varieties:** White beans (*Farin wake*), Dan Amarya beans (*Dan Amarya*)
- **DRAFT:** A grain legume, widely known in Nigeria as beans, grown for food and sold dried.
- `[ ] approve  [ ] edit  [ ] reject  [ ] replace` — notes:

### 7. Groundnut
- **SOURCED varieties:** Groundnuts (*Gyada*)
- **DRAFT:** An oilseed legume grown mainly in northern Nigeria, sold as nuts or processed for oil and paste.
- `[ ] approve  [ ] edit  [ ] reject  [ ] replace` — notes:
- *Taxonomy note: recorded as "Groundnuts" in `commodity_varieties`.*

### 8. Sesame
- **SOURCED varieties:** none recorded
- **DRAFT:** An oilseed grown largely for export from Nigeria, valued for its seed and oil.
- `[ ] approve  [ ] edit  [ ] reject  [ ] replace` — notes:

### 9. Cassava
- **SOURCED varieties:** Cassava (*Dan Wake*)
- **DRAFT:** A starchy root crop, processed after harvest into products such as garri, flour and starch. It deteriorates quickly once lifted, so it is usually processed or sold soon after harvest.
- `[ ] approve  [ ] edit  [ ] reject  [ ] replace` — notes:

### 10. Yam
- **SOURCED varieties:** none recorded
- **DRAFT:** A starchy tuber crop, a staple in central and southern Nigeria, sold fresh and stored in barns.
- `[ ] approve  [ ] edit  [ ] reject  [ ] replace` — notes:

### 11. Cocoa
- **SOURCED varieties:** none recorded
- **DRAFT:** A tree crop grown mainly in south-western Nigeria, with beans fermented and dried after harvest, largely for export.
- `[ ] approve  [ ] edit  [ ] reject  [ ] replace` — notes:

### 12. Cashew
- **SOURCED varieties:** none recorded
- **DRAFT:** A tree crop producing nuts that are dried and largely exported, with the cashew apple sometimes used locally.
- `[ ] approve  [ ] edit  [ ] reject  [ ] replace` — notes:

### 13. Ginger
- **SOURCED varieties:** none recorded
- **DRAFT:** A rhizome spice crop, sold fresh or dried, with a substantial export market from Nigeria.
- `[ ] approve  [ ] edit  [ ] reject  [ ] replace` — notes:

### 14. Chili Pepper
- **SOURCED varieties (recorded as "Pepper"):** Dan Miyare, Dan Zagade, Dan Minci, Daushe, Dan Legas, Tarugu, Shambo
- **DRAFT:** A vegetable spice crop sold fresh or dried. Drying is common because fresh pepper is perishable.
- `[ ] approve  [ ] edit  [ ] reject  [ ] replace` — notes:
- *Taxonomy note: recorded as "Pepper" in `commodity_varieties`.*

### 15. Hibiscus
- **SOURCED varieties:** none recorded
- **DRAFT:** A crop grown for its dried calyces, used for the drink known locally as zobo and exported for beverage and food use.
- `[ ] approve  [ ] edit  [ ] reject  [ ] replace` — notes:

---

## After review

1. Reviewer records **name, affiliation and date** — the knowledge pack's
   `Reviewer` shape already requires these, and `sourceFor()` refuses to print
   "reviewed" without them.
2. Approved text is stored with a review status and an attribution that does
   **not** read "Loamy platform guide" for agronomic claims.
3. Only then is `commodityEvidence` built and wired, with its own tests.

Until steps 1–3 are complete this file stays exactly what its title says.
