import type { TranslationPack } from '../en'

/**
 * Igbo — the logged-out site and the highest-traffic shop surfaces.
 *
 * Added because the public landing is where a visitor first meets the product:
 * falling back to English there means the language choice appears to do
 * nothing, even though the architecture is working. The marketing and chrome
 * vocabulary here is everyday Igbo I can establish with reasonable confidence.
 *
 * Financing, traceability and settlement wording remains absent on purpose and
 * still falls back to English. See glossary.md.
 *
 * NOT reviewed by a native speaker.
 */
export const igPublic: TranslationPack = {
  'public.deliverTo': 'Nyefee na',
  'public.deliverToState': 'Steeti nnyefe',
  'public.allNigeria': 'Naịjirịa niile',
  'public.allCategories': 'Ụdị niile',
  'public.searchCategory': 'Chọọ ụdị',
  'public.searchPlaceholder': 'Chọọ ngwá ahịa, ihe ubi, ma ọ bụ ndị na-eweta…',
  'public.searchPlaceholderShort': 'Chọọ ngwá ahịa…',
  'public.searchTheMarketplace': 'Chọọ n’ahịa',
  'public.signIn': 'Banye',
  'public.getStarted': 'Malite',
  'public.orders': 'Iwu',
  'public.menu': 'Menu',
  'public.sections': 'Akụkụ',
  'public.footer': 'Ala peeji',
  'public.privacyPreferences': 'Nhọrọ nzuzo',

  'public.heroTitle': 'Sistemụ Ọrụ maka Ọrụ Ugbo',
  'public.heroSubtitle': 'Ijikọ onye ọ bụla nọ na usoro ọrụ ugbo Naịjirịa site na njirimara akwadoro, nkwado ego, ahịa na ozi.',
  'public.becomeFoundingMember': 'Bụrụ onye ntọala',
  'public.browseMarketplace': 'Lelee ahịa',
  'public.fourPillars': 'Otu ikpo okwu, ogidi anọ',
  'public.howItWorks': 'Otu ọ si arụ ọrụ',
  'public.banksDecide': 'Loamy na-ejikọ usoro ahụ. Ụlọ akụ na-ekpebi ihe niile gbasara nkwado ego.',
  'public.whoItsFor': 'Onye ọ dịrị',
  'public.fromTheMarketplace': 'Site n’ahịa',
  'public.browseAllListings': 'Lelee ngosi niile',
  'public.joinFoundingMember': 'Sonye dị ka onye ntọala.',
  'public.about': 'Banyere anyị',
  'public.contact': 'Kpọtụrụ anyị',

  'public.pillar.identity.title': 'Njirimara Dijitalụ',
  'public.pillar.marketplace.title': 'Ahịa',
  'public.pillar.intelligence.title': 'Ozi Ahịa',
  'public.step.register.title': 'Debanye aha',
  'public.step.verify.title': 'Nyochaa',
  'public.step.sell.title': 'Ree',
  'public.step.history.title': 'Wuo akụkọ',

  // high-traffic shop surfaces, so the change is visible where people look
  'cart.yourCart': 'Nkata gị',
  'cart.isEmpty': 'Nkata gị tọgbọrọ chakoo.',
  'cart.orderSummary': 'Nchịkọta iwu',
  'cart.items_label': 'Ihe',
  'cart.proceedToCheckout': 'Gaa na ịkwụ ụgwọ',
  'cart.continueShopping': 'Gaa n’ihu ịzụ ahịa',
  'marketplace.allCategories': 'Ụdị niile',
  'marketplace.allStates': 'Steeti niile',
  'marketplace.featuredCategories': 'Ụdị ndị pụtara ìhè',
  'marketplace.category': 'Ụdị',
  'marketplace.noListingsMatch': 'Ọ dịghị ngosi dabara',
  'dashboard.farms': 'Ugbo',
  'dashboard.marketToday': 'Ahịa taa',
  'dashboard.nothingHappenedYet': 'Ọ dịghị ihe mere ugbu a',
  'public.featuredListings': 'Ngosi ndị a kapịrị ọnụ',
  'public.seeAllListings': 'Hụ ngosi niile',
  // --- the landing page ----------------------------------------------------
  'public.disclaimer': 'Loamy abụghị onye na-agbazinye ego. Ụlọ akụ ndị mmekọ na-ekpebi banyere nkwado ego, onye mmekọ ịkwụ ụgwọ anyị a kwadoro na-ejide ego ahịa.',
  'public.heroImageAlt': "Onye ọrụ ugbo ji akpụ ọ ka wepụtara n'ubi ya",
  'public.joinBody': "Ohere mbụ na ndebanye aha izizi ka Loamy na-agbasa n'ofe ụzọ azụmahịa ọrụ ugbo Naịjirịa.",
  'public.pillar.financing.title': 'Akụrụngwa nkwado ego',
  'public.pillar.financing.body': "Profaịlụ akwadoro na-eme ka ụlọ akụ ndị mmekọ nwee ike ịlele ma nye nkwado ego n'obi ike. Usoro na-anaghị ewe ọmụrụnwa: Murabaha na Salam.",
  'public.pillar.identity.body': 'Onye ọ bụla sonyere na-enweta Loamy ID akwadoro, nke nkwenye ubi kwadoro.',
  'public.pillar.intelligence.body': 'Ezigbo ọnụahịa ngwaahịa site na steeti na ahịa.',
  'public.pillar.marketplace.body': 'Ndị ọrụ ugbo, ndị ahịa, ndị mbupụ na ndị na-azụ ahịa akwadoro, jikọtara ozugbo.',
  'public.role.farmer': "Kọọ, nweta nkwenye, nweta nkwado ego site n'aka ụlọ akụ ndị mmekọ.",
  'public.role.buyer': "Zụta ngwaahịa akwadoro ozugbo site n'isi iyi.",
  'public.role.trader': 'Chọta, chịkọta ma zụọ ngwaahịa akwadoro.',
  'public.role.exporter': 'Bupụ ngwaahịa Naịjirịa akwadoro gaa ahịa mba ọzọ.',
  'public.role.growth_partner': "Debanye ma kwado ndị ọrụ ugbo n'ubi.",
  'public.role.input_supplier': 'Nye mkpụrụ, fatịlaịza na akụrụngwa ndị ọrụ ugbo akwadoro.',
  'public.role.logistics_provider': "Buru ngwaahịa site n'ubi gaa ahịa na ọdụ ụgbọ mmiri.",
  'public.role.warehouse_owner': "Nye ohere nchekwa akwadoro n'ofe ụzọ ahụ.",
  'public.step.register.body': 'Onye ọrụ ugbo ma ọ bụ onye ahịa debanyere aha na nkeji abụọ.',
  'public.step.verify.body': 'Onye Mmekọ Uto na-eleta ugbo ma were ihe àmà jikọtara na GPS.',
  'public.step.finance.title': 'Nkwado ego',
  'public.step.finance.body': 'Profaịlụ akwadoro na-aga ụlọ akụ mmekọ; ụlọ akụ na-ekpebi ma na-akwụ ụgwọ.',
  'public.step.sell.body': 'A na-edepụta ihe ubi nye ndị na-azụ ahịa, ndị ahịa na ndị mbupụ akwadoro.',
  'public.step.store.title': 'Chekwaa ma buga',
  'public.step.store.body': "Ụlọ nkwakọba na ndị na-ebu ngwaahịa nọ n'otu ndepụta ahụ.",
  'public.step.history.body': 'Oge ọ bụla edekọrọ na-eme ka arịrịọ ọzọ sie ike.',
}
