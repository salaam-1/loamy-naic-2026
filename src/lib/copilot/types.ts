/**
 * Loamy Co-pilot v1 — domain types (mirror the additive schema in
 * 20260804090001_loamy_copilot_v1_schema.sql).
 *
 * The Co-pilot is retrieval-only: it answers from these uploaded rows and admin
 * overrides, never from model knowledge or the web. It reports observed prices
 * and observed historical patterns — it never predicts a price and never gives
 * financial advice.
 */

export type CopilotLanguage = 'en' | 'ha' // English, Hausa (Kananci)

export type PriceType = 'retail' | 'wholesale' | 'farmgate'

export type UploadDataType = 'prices' | 'macro' | 'events'

/** A versioned, reversible upload. Rollback = set `active` false. */
export interface UploadBatch {
  id: string
  uploaded_by: string | null
  uploaded_at: string
  file_name: string
  row_count: number
  data_type: UploadDataType
  notes: string | null
  active: boolean
}

/** The uploaded reference dataset — the single source of truth for Price Check. */
export interface MarketPriceHistory {
  id: string
  date: string
  state: string | null
  lga: string | null
  market: string | null
  latitude: number | null
  longitude: number | null
  commodity: string
  price_type: PriceType
  price_ngn_per_kg: number
  source: string | null
  quality_flag: string | null
  upload_batch_id: string | null
  created_at: string
}

export interface MacroContext {
  id: string
  year: number
  month: number
  ngn_per_usd: number | null
  food_cpi: number | null
  upload_batch_id: string | null
  created_at: string
}

/** Dated, hand-verified events used to annotate charts / explain movements. */
export interface MarketEvent {
  id: string
  start_date: string
  end_date: string | null
  event: string
  region: string | null
  upload_batch_id: string | null
}

export interface CopilotConversation {
  id: string
  user_id: string
  started_at: string
  language: CopilotLanguage
}

export type CopilotRole = 'user' | 'assistant'

/**
 * One chat message. For assistant messages, `data_sources` records exactly
 * which rows/batch were used and `data_as_of` the newest record date — both
 * surfaced to the user so every answer is traceable to uploaded data.
 */
export interface CopilotMessage {
  id: string
  conversation_id: string
  role: CopilotRole
  content: string
  data_sources: DataSourceRef[]
  data_as_of: string | null
  was_answered: boolean
  created_at: string
}

/** Provenance for a single answer — stored in copilot_messages.data_sources. */
/** Observed monthly price series + real market-event markers for a Price Check
 * chart. Never contains a future/predicted point. */
export interface CopilotChart {
  points: { key: string; price: number }[]
  events: { at: string; label: string }[]
  unit: string
}

export interface DataSourceRef {
  /** Which table the rows came from. */
  table: 'market_prices_history' | 'macro_context' | 'market_events' | 'copilot_qa_overrides' | 'market_price_updates'
  /** Human-readable source label(s), e.g. "WFP", "FEWS NET". */
  source?: string | null
  /** Which upload batch(es) the rows belonged to. */
  batch_ids?: string[]
  /** How many rows informed the answer. */
  row_count?: number
}

export interface CopilotQaOverride {
  id: string
  question_pattern: string
  answer: string
  language: CopilotLanguage
  active: boolean
  created_by: string | null
  created_at: string
}

export interface CopilotFlaggedQuestion {
  id: string
  question: string
  language: CopilotLanguage
  user_id: string | null
  asked_at: string
  resolved: boolean
  resolution_note: string | null
}

/**
 * FUTURE-MODEL SEAM ONLY. Ships empty and unused behind the
 * `copilot_predictions` flag (OFF). No predicted price is ever rendered in v1.
 */
export interface Prediction {
  id: string
  commodity: string
  state: string | null
  target_date: string
  predicted_price: number | null
  confidence_low: number | null
  confidence_high: number | null
  model_version: string | null
  generated_at: string
}

/** The verbatim disclaimer — shown on first open of every session and in the panel footer. */
export const COPILOT_DISCLAIMER =
  'Loamy Co-pilot reports observed prices and historical patterns from recorded market data. It does ' +
  'not predict future prices and does not provide financial advice. All financing decisions are made ' +
  'by partner banks.'
