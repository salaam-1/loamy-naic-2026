# Image credits

This file **is** the attribution for Loamy's hero photographs. It is not a
convenience copy of something shown elsewhere.

All five heroes are real Nigerian farming, trading, haulage and processing
scenes from Wikimedia Commons, each licensed **CC BY-SA 4.0**.

## How the licence is satisfied

CC BY-SA 4.0 requires that the creator, the source, the licence and any
modifications be identified. Clause 3(a)(2) allows those conditions to be met
"in any reasonable manner based on the medium, means, and context", and gives
linking to a resource that carries the information as an example.

Loamy relies on that clause. The public site footer carries an **Image
credits** link that resolves to this file, which holds the full notice below.

Two consequences follow, and both matter:

1. **This file must stay reachable at `/images/IMAGE-CREDITS.md`.** It lives in
   `public/`, so it is copied into the build as-is. Moving it breaks the
   attribution, not just a link.
2. **The footer link must stay.** A paragraph of names is optional; a pointer
   is not. `tests/unit/image-credits.test.ts` fails if the link is removed from
   `src/pages/public/PublicShell.tsx` while any CC-licensed hero is still in
   use.

**Modifications:** every file below was cropped to 1920x1080 and re-encoded as
JPEG (q80, mozjpeg) from the Commons original. No other changes were made.

**Disclaimer of warranties:** the material is licensed as-is; see the licence
text for the full disclaimer.

**Licence:** https://creativecommons.org/licenses/by-sa/4.0/

## The photographs

- **hero-harvest.jpg** - "Rice harvest from the farm" by **Photobyamin**, CC BY-SA 4.0.
  https://commons.wikimedia.org/wiki/File:Rice_harvest_from_the_farm.jpg
  Used for the "Trade. Grow. Thrive." slide.

- **hero-market.jpg** - "Dawanau Market" by **SMMIMAGES**, CC BY-SA 4.0.
  https://commons.wikimedia.org/wiki/File:Dawanau_Market.png
  Dawanau, Kano - West Africa's largest grain market. Used for the
  "Buy direct from verified sellers." slide.

- **hero-farmer.jpg** - "A Farmer Harvesting Cassava Root" by **OnyekeEjike**, CC BY-SA 4.0.
  https://commons.wikimedia.org/wiki/File:A_Farmer_Harvesting_Cassava_Root.jpg
  Used for the "Real produce. Real people." slide, and on /welcome.

- **hero-logistics.jpg** - "A group of men loading refined soya beans onto a
  truck" by **Gole Andrew**, CC BY-SA 4.0.
  https://commons.wikimedia.org/wiki/File:A_group_of_men_loading_refined_soya_beans_onto_a_truck.jpg
  Used for the Logistics Provider dashboard hero.

- **hero-processing.jpg** - "Cassava Processing Machine 3" by **OnyekeEjike**, CC BY-SA 4.0.
  https://commons.wikimedia.org/wiki/File:Cassava_Processing_Machine_3.jpg
  Used for the Processor dashboard hero.

## If these are replaced

The team may swap in owned or licensed photographs before public launch. Drop
new files at the same paths, keep them 16:9, update the list above, and only
once **no CC-licensed image remains** may the footer credits link go. The test
named above encodes that condition so it cannot be removed by accident.

## Previously used

- ~~hero.jpg~~ - "Maize field, Aduwan, Kafanchan, Nigeria" by Kambai Akau
  (CC BY-SA 4.0). Removed 2026-09-19: the static maize field was replaced by the
  rotating people-led photography above.
