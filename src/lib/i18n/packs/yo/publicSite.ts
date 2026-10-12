import type { TranslationPack } from '../en'

/**
 * Yorùbá — the logged-out site and the highest-traffic shop surfaces.
 *
 * Same reasoning as the Igbo public pack: the landing page is where a visitor
 * first meets the product, and falling back to English there makes the language
 * choice look inert even when the architecture is working.
 *
 * Diacritics are written in full; `ọjà` (market) is not `oja`.
 *
 * Financing, traceability and settlement wording remains absent on purpose and
 * still falls back to English. See glossary.md.
 *
 * NOT reviewed by a native speaker.
 */
export const yoPublic: TranslationPack = {
  'public.deliverTo': 'Fi ránṣẹ́ sí',
  'public.deliverToState': 'Ìpínlẹ̀ ìfijíṣẹ́',
  'public.allNigeria': 'Gbogbo Nàìjíríà',
  'public.allCategories': 'Gbogbo ẹ̀ka',
  'public.searchCategory': 'Wá ẹ̀ka',
  'public.searchPlaceholder': 'Wá ọjà, ohun ọ̀gbìn, tàbí olùpèsè…',
  'public.searchPlaceholderShort': 'Wá ọjà…',
  'public.searchTheMarketplace': 'Wá ní ọjà',
  'public.signIn': 'Wọlé',
  'public.getStarted': 'Bẹ̀rẹ̀',
  'public.orders': 'Àwọn ìbéèrè',
  'public.menu': 'Àtòjọ',
  'public.sections': 'Àwọn apá',
  'public.footer': 'Ìsàlẹ̀ ojú ìwé',
  'public.privacyPreferences': 'Ìfẹ́ àṣírí',

  'public.heroTitle': 'Ètò Iṣẹ́ fún Iṣẹ́ Àgbẹ̀',
  'public.heroSubtitle': 'Ìsopọ̀ gbogbo ẹni tó wà nínú ẹ̀wọ̀n iṣẹ́ àgbẹ̀ Nàìjíríà nípasẹ̀ ìdánimọ̀ tí a ti jẹ́rìísí, ìnáwó, ọjà àti ìmọ̀.',
  'public.becomeFoundingMember': 'Di ọmọ ẹgbẹ́ ìpilẹ̀ṣẹ̀',
  'public.browseMarketplace': 'Wo ọjà',
  'public.fourPillars': 'Pẹpẹ kan, ọwọ̀n mẹ́rin',
  'public.howItWorks': 'Bí ó ṣe ń ṣiṣẹ́',
  'public.banksDecide': 'Loamy ń so ẹ̀wọ̀n náà pọ̀. Àwọn báńkì ló ń ṣe gbogbo ìpinnu ìnáwó.',
  'public.whoItsFor': 'Ta ni ó wà fún',
  'public.fromTheMarketplace': 'Láti ọjà',
  'public.browseAllListings': 'Wo gbogbo ìpolówó',
  'public.joinFoundingMember': 'Darapọ̀ mọ́ wa gẹ́gẹ́ bí ọmọ ẹgbẹ́ ìpilẹ̀ṣẹ̀.',
  'public.about': 'Nípa wa',
  'public.contact': 'Kàn sí wa',

  'public.pillar.identity.title': 'Ìdánimọ̀ Dijítà',
  'public.pillar.marketplace.title': 'Ọjà',
  'public.pillar.intelligence.title': 'Ìmọ̀ Ọjà',
  'public.step.register.title': 'Forúkọsílẹ̀',
  'public.step.verify.title': 'Jẹ́rìísí',
  'public.step.sell.title': 'Tà',
  'public.step.history.title': 'Kọ́ ìtàn',

  // high-traffic shop surfaces
  'cart.yourCart': 'Agbọ̀n rẹ',
  'cart.isEmpty': 'Agbọ̀n rẹ ṣófo.',
  'cart.orderSummary': 'Àkótán ìbéèrè',
  'cart.items_label': 'Àwọn nǹkan',
  'cart.proceedToCheckout': 'Tẹ̀síwájú sí sísanwó',
  'cart.continueShopping': 'Tẹ̀síwájú ríra',
  'marketplace.allCategories': 'Gbogbo ẹ̀ka',
  'marketplace.allStates': 'Gbogbo ìpínlẹ̀',
  'marketplace.featuredCategories': 'Àwọn ẹ̀ka pàtàkì',
  'marketplace.category': 'Ẹ̀ka',
  'marketplace.noListingsMatch': 'Kò sí ìpolówó tó bá a mu',
  'dashboard.farms': 'Oko',
  'dashboard.marketToday': 'Ọjà lónìí',
  'dashboard.nothingHappenedYet': 'Kò sí nǹkan tó ṣẹlẹ̀ síbẹ̀',
  'public.featuredListings': 'Àwọn ìpolówó pàtàkì',
  'public.seeAllListings': 'Wo gbogbo ìpolówó',
  // --- the landing page ----------------------------------------------------
  'public.disclaimer': 'Loamy kì í yá owó. Àwọn báńkì alábàáṣiṣẹ́ ni wọ́n ń pinnu ìnáwó, alábàáṣiṣẹ́ ìsanwó wa tí ìjọba fọwọ́ sí ni ó ń di owó ọjà mú.',
  'public.heroImageAlt': 'Àgbẹ̀ kan tí ó gbé gbaguda tí ó ṣẹ̀ṣẹ̀ kórè láti oko rẹ̀',
  'public.joinBody': 'Àǹfààní àkọ́kọ́ àti ìforúkọsílẹ̀ ṣíṣáájú bí Loamy ṣe ń tàn káàkiri ẹ̀wọ̀n iṣẹ́ àgbẹ̀ Nàìjíríà.',
  'public.pillar.financing.title': 'Ìpìlẹ̀ ìnáwó',
  'public.pillar.financing.body': 'Àkọọ́lẹ̀ tí a ti jẹ́rìísí jẹ́ kí àwọn báńkì alábàáṣiṣẹ́ lè yẹ̀wò kí wọ́n sì náwó pẹ̀lú ìgboyà. Ètò tí kò ní èlé: Murabaha àti Salam.',
  'public.pillar.identity.body': 'Olúkúlùkù ẹni tí ó kópa ní Loamy ID tí a jẹ́rìísí, tí ìjẹ́rìísí pápá ti fọwọ́ sí.',
  'public.pillar.intelligence.body': 'Owó ọjà tòótọ́ ní ìbámu pẹ̀lú ìpínlẹ̀ àti ọjà.',
  'public.pillar.marketplace.body': 'Àwọn àgbẹ̀, oníṣòwò, olùkó-ọjà-sóde àti olùrà tí a jẹ́rìísí, tí a so pọ̀ tààrà.',
  'public.role.farmer': 'Gbin, jẹ́ kí a jẹ́rìísí rẹ, kí o sì rí ìnáwó látọ̀dọ̀ àwọn báńkì alábàáṣiṣẹ́.',
  'public.role.buyer': 'Ra ọjà tí a jẹ́rìísí tààrà láti orísun.',
  'public.role.trader': 'Wá, kó jọ, kí o sì ta ọjà tí a jẹ́rìísí.',
  'public.role.exporter': 'Kó ọjà Nàìjíríà tí a jẹ́rìísí sí àwọn ọjà òkèrè.',
  'public.role.growth_partner': 'Forúkọ àwọn àgbẹ̀ sílẹ̀ kí o sì jẹ́rìísí wọn ní pápá.',
  'public.role.input_supplier': 'Pèsè irúgbìn, ajílẹ̀ àti ohun èlò fún àwọn àgbẹ̀ tí a jẹ́rìísí.',
  'public.role.logistics_provider': 'Gbé ọjà láti oko sí ọjà àti èbúté.',
  'public.role.warehouse_owner': 'Pèsè ààyè ìtọ́jú ọjà tí a jẹ́rìísí ní gbogbo ẹ̀wọ̀n náà.',
  'public.step.register.body': 'Àgbẹ̀ tàbí oníṣòwò forúkọsílẹ̀ ní ìṣẹ́jú méjì.',
  'public.step.verify.body': 'Alábàáṣiṣẹ́ Ìdàgbàsókè ń bẹ oko wò, ó sì ń kó ẹ̀rí tí ó bá GPS mu.',
  'public.step.finance.title': 'Ìnáwó',
  'public.step.finance.body': 'Àkọọ́lẹ̀ tí a jẹ́rìísí ń lọ sí báńkì alábàáṣiṣẹ́; báńkì ni ó ń pinnu tí ó sì ń san owó náà.',
  'public.step.sell.body': 'A ń polówó ìkórè fún àwọn olùrà, oníṣòwò àti olùkó-ọjà-sóde tí a jẹ́rìísí.',
  'public.step.store.title': 'Tọ́jú àti gbé',
  'public.step.store.body': 'Àwọn ilé ìtọ́jú ọjà àti olùgbé ọjà wà nínú àtọ́jọ kan náà.',
  'public.step.history.body': 'Gbogbo àkókò tí a kọ sílẹ̀ ń mú ìbéèrè tó kàn lókun sí i.',
}
