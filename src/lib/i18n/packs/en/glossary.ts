/**
 * Canonical platform terminology.
 *
 * These twenty terms carry the product's meaning. They appear inside hundreds
 * of other strings, so getting them right once is worth more than translating
 * any single screen. Every other pack must use the SAME term for the same
 * concept — see glossary.md for the per-language decisions and, importantly,
 * for the terms where the decision was to keep the English.
 *
 * A term here is the singular noun as it appears in running text.
 */
export const glossary = {
  'term.commodity': 'commodity',
  'term.batch': 'batch',
  'term.harvest': 'harvest',
  'term.farm': 'farm',
  'term.listing': 'listing',
  'term.transaction': 'transaction',
  'term.financing': 'financing',
  'term.verification': 'verification',
  'term.growthPartner': 'Growth Partner',
  'term.logistics': 'logistics',
  'term.warehouse': 'warehouse',
  'term.exporter': 'exporter',
  'term.processor': 'processor',
  'term.buyer': 'buyer',
  'term.trader': 'trader',
  'term.supplier': 'supplier',
  'term.traceability': 'traceability',
  'term.loading': 'loading',
  'term.delivery': 'delivery',
  'term.settlement': 'settlement',

  // plural forms, because several languages do not pluralise by suffix
  'term.commodity_plural': 'commodities',
  'term.batch_plural': 'batches',
  'term.farm_plural': 'farms',
  'term.listing_plural': 'listings',
  'term.transaction_plural': 'transactions',
  'term.warehouse_plural': 'warehouses',
} as const
