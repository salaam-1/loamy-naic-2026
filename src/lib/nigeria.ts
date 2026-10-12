/**
 * Nigeria's 36 states + FCT, for signup and onboarding selects.
 * Values must EXACTLY match the portal's profiles_state_check constraint
 * (which spells the capital territory 'FCT').
 */
export const NIGERIA_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue',
  'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu',
  'FCT', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina',
  'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo',
  'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
] as const

/**
 * The FIXED commodity taxonomy — this is the complete list, platform-wide.
 * HARD CONSTRAINT: livestock and animal products are excluded from the
 * platform entirely and must never be added to this list.
 */
export const COMMODITIES = [
  'Maize', 'Rice', 'Sorghum', 'Millet',
  'Soybeans', 'Cowpea', 'Groundnut', 'Sesame',
  'Cassava', 'Yam',
  'Cocoa', 'Cashew',
  'Ginger', 'Chili Pepper', 'Hibiscus',
] as const

export type Commodity = (typeof COMMODITIES)[number]

/**
 * Presentational grouping of the FIXED commodity taxonomy — for the marketplace
 * category rail and featured grid. This only organises the existing COMMODITIES
 * into readable buckets; it adds no new commodity and (per hard constraint)
 * contains no livestock or animal products. `icon` names map to lucide icons in
 * the UI layer (kept as strings here so this stays a data-only module).
 */
export interface CommodityGroup {
  key: string
  label: string
  icon: string
  commodities: Commodity[]
}

export const COMMODITY_GROUPS: CommodityGroup[] = [
  { key: 'grains', label: 'Grains & Cereals', icon: 'Wheat', commodities: ['Maize', 'Rice', 'Sorghum', 'Millet'] },
  { key: 'legumes', label: 'Legumes & Oilseeds', icon: 'Bean', commodities: ['Soybeans', 'Cowpea', 'Groundnut', 'Sesame'] },
  { key: 'roots', label: 'Roots & Tubers', icon: 'Carrot', commodities: ['Cassava', 'Yam'] },
  { key: 'tree', label: 'Tree Crops', icon: 'Trees', commodities: ['Cocoa', 'Cashew'] },
  { key: 'spices', label: 'Spices & Herbs', icon: 'Flame', commodities: ['Ginger', 'Chili Pepper', 'Hibiscus'] },
]
