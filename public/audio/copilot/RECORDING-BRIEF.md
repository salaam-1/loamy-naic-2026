# Loamy Co-pilot — voice recording brief (v1)

Single Kano (Kananci) voice actor. Latin/Boko script. Natural, calm, helpful
tone. Record each FIXED phrase below as a separate clip.

## Delivery

- Format: MP3 (mono is fine), normalised, no background noise.
- File name = the phrase **key** below, lowercase, e.g. `clarify_commodity.mp3`.
- Drop files here:
  - Kananci: `public/audio/copilot/ha-KAN/<key>.mp3`
  - English (optional): `public/audio/copilot/en/<key>.mp3`
- Then flip the matching key to `true` in `src/lib/copilot/i18n/voice.ts`. The UI
  shows a “Play” button automatically; until then it falls back to text.

## Fixed phrases to record

Only these fully static phrases get clips. Everything else (actual prices,
market summaries) is dynamic and stays text-only in v1 — do **not** record numbers.

| key | English | Kananci (Kano Hausa) |
|-----|---------|----------------------|
| `welcome` | Ask about a commodity price, request a market update, or start a listing or logistics draft. | Ka tambaya kan farashin kaya, ko labarin kasuwa, ko ka fara tsara talla ko buƙatar jigila. |
| `clarify_commodity` | Which commodity would you like the price for? For example: maize, rice, sorghum, cowpea… | Wanne kaya kake son sanin farashinsa? Misali: masara, shinkafa, dawa, wake… |
| `capabilities` | I can help with commodity prices, drafting a listing, market updates, or a logistics request. I’ve logged your question for the Loamy team. | Zan iya taimaka da farashin kaya, tsara talla, labaran kasuwa, ko buƙatar jigila. Na adana tambayarka domin ƙungiyar Loamy. |
| `market_update_none` | There are no recent market records uploaded yet. I’ve logged your question. | Babu sabbin bayanan kasuwa da aka loda tukuna. Na adana tambayarka. |

The canonical text lives in `src/lib/copilot/i18n/registry.ts` (`fixed` on each
dialect). If the wording there changes, re-record the affected clip.

## Adding a second dialect later

Add one `Dialect` object to `DIALECTS` in `registry.ts` (its own `code`, e.g.
`ha-SOK` for Sakkwatanci), record clips under `public/audio/copilot/<code>/`,
and register them in `voice.ts`. No other code changes required.
