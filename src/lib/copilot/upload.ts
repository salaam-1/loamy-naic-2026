import { supabase } from '@/lib/supabase'
import type { UploadDataType } from '@/lib/copilot/types'

/**
 * Upload parsing + validation for the Co-pilot data portal. v1 accepts CSV; the
 * `parseCsv` seam is where an Excel reader (e.g. SheetJS) plugs in later without
 * changing the validators. Rejected rows are returned with reasons and shown to
 * the admin — never silently dropped.
 *
 * HARD CONSTRAINT: NO livestock. Any row whose commodity matches an animal /
 * livestock product is rejected here, at the door.
 */

const LIVESTOCK_TERMS = [
  'livestock', 'animal', 'beef', 'cattle', 'cow', 'goat', 'sheep', 'ram', 'mutton',
  'chicken', 'poultry', 'broiler', 'egg', 'meat', 'pork', 'pig', 'fish', 'milk', 'dairy',
]

export function isLivestock(commodity: string): boolean {
  const c = commodity.toLowerCase()
  return LIVESTOCK_TERMS.some((t) => new RegExp(`\\b${t}s?\\b`).test(c))
}

/** Minimal CSV parser: handles double-quoted fields and quoted commas. Strips a
 * leading UTF-8 BOM (Excel/Windows add one, which otherwise corrupts the first
 * header so its column can't be found). */
export function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some((c) => c.trim() !== '')) rows.push(row)
      row = []
    } else field += ch
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((c) => c.trim() !== '')) rows.push(row) }
  return rows
}

const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, '_')

export interface RejectedRow {
  line: number
  reason: string
  raw: string
}

export interface UploadValidation {
  dataType: UploadDataType
  headers: string[]
  accepted: Record<string, unknown>[]
  rejected: RejectedRow[]
}

const HEADER_ALIASES: Record<string, string> = {
  price: 'price_ngn_per_kg',
  price_per_kg: 'price_ngn_per_kg',
  price_ngn: 'price_ngn_per_kg',
  lat: 'latitude',
  lng: 'longitude',
  long: 'longitude',
  usd: 'ngn_per_usd',
  ngn_usd: 'ngn_per_usd',
  fx: 'ngn_per_usd',
  cpi: 'food_cpi',
  // Events files commonly use start / end rather than start_date / end_date.
  start: 'start_date',
  startdate: 'start_date',
  end: 'end_date',
  enddate: 'end_date',
}

const PRICE_TYPES = ['retail', 'wholesale', 'farmgate']
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))
const numOrNull = (s: string) => { const n = Number(s); return s.trim() === '' || Number.isNaN(n) ? null : n }

/** Validate a CSV against the schema for its data type. */
export function validateUpload(text: string, dataType: UploadDataType): UploadValidation {
  const grid = parseCsv(text)
  if (grid.length < 2) return { dataType, headers: [], accepted: [], rejected: [{ line: 0, reason: 'File has no data rows.', raw: '' }] }

  const headers = grid[0].map((h) => HEADER_ALIASES[norm(h)] ?? norm(h))
  const idx = (name: string) => headers.indexOf(name)
  const accepted: Record<string, unknown>[] = []
  const rejected: RejectedRow[] = []
  const get = (cells: string[], name: string) => { const i = idx(name); return i >= 0 ? (cells[i] ?? '').trim() : '' }

  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r]
    const raw = cells.join(',')
    const reject = (reason: string) => rejected.push({ line: r + 1, reason, raw })

    if (dataType === 'prices') {
      const date = get(cells, 'date')
      const commodity = get(cells, 'commodity')
      const priceType = get(cells, 'price_type').toLowerCase()
      const price = get(cells, 'price_ngn_per_kg')
      if (!isDate(date)) { reject('Invalid or missing date (expected YYYY-MM-DD).'); continue }
      if (!commodity) { reject('Missing commodity.'); continue }
      if (isLivestock(commodity)) { reject(`Livestock/animal product excluded: "${commodity}".`); continue }
      if (!PRICE_TYPES.includes(priceType)) { reject(`price_type must be one of ${PRICE_TYPES.join('/')}.`); continue }
      const p = Number(price)
      if (!Number.isFinite(p) || p <= 0) { reject('price_ngn_per_kg must be a positive number.'); continue }
      accepted.push({
        date, commodity, price_type: priceType, price_ngn_per_kg: p,
        state: get(cells, 'state') || null, lga: get(cells, 'lga') || null, market: get(cells, 'market') || null,
        latitude: numOrNull(get(cells, 'latitude')), longitude: numOrNull(get(cells, 'longitude')),
        source: get(cells, 'source') || null, quality_flag: get(cells, 'quality_flag') || null,
      })
    } else if (dataType === 'macro') {
      const year = Number(get(cells, 'year')); const month = Number(get(cells, 'month'))
      if (!Number.isInteger(year) || year < 1990 || year > 2100) { reject('Invalid year.'); continue }
      if (!Number.isInteger(month) || month < 1 || month > 12) { reject('Invalid month (1–12).'); continue }
      accepted.push({ year, month, ngn_per_usd: numOrNull(get(cells, 'ngn_per_usd')), food_cpi: numOrNull(get(cells, 'food_cpi')) })
    } else {
      const start = get(cells, 'start_date'); const event = get(cells, 'event')
      const end = get(cells, 'end_date')
      if (!isDate(start)) { reject('Invalid or missing start_date.'); continue }
      if (!event) { reject('Missing event.'); continue }
      if (end && !isDate(end)) { reject('Invalid end_date.'); continue }
      accepted.push({ start_date: start, event, end_date: end || null, region: get(cells, 'region') || null })
    }
  }
  return { dataType, headers, accepted, rejected }
}

const TARGET_TABLE: Record<UploadDataType, string> = {
  prices: 'market_prices_history',
  macro: 'macro_context',
  events: 'market_events',
}

/** Create a versioned batch and insert its validated rows. */
export async function commitUpload(params: {
  dataType: UploadDataType
  fileName: string
  notes: string
  rows: Record<string, unknown>[]
  uploadedBy: string
}): Promise<{ ok: true; batchId: string; inserted: number } | { ok: false; error: string }> {
  const { dataType, fileName, notes, rows, uploadedBy } = params
  const { data: batch, error: batchErr } = await supabase
    .from('upload_batches')
    .insert({ uploaded_by: uploadedBy, file_name: fileName, row_count: rows.length, data_type: dataType, notes: notes || null, active: true })
    .select('id')
    .single()
  if (batchErr || !batch) return { ok: false, error: batchErr?.message ?? 'Could not create batch.' }

  const batchId = (batch as { id: string }).id
  const withBatch = rows.map((r) => ({ ...r, upload_batch_id: batchId }))
  let inserted = 0
  for (let i = 0; i < withBatch.length; i += 500) {
    const chunk = withBatch.slice(i, i + 500)
    const { error } = await supabase.from(TARGET_TABLE[dataType]).insert(chunk)
    if (error) return { ok: false, error: `Inserted ${inserted} rows, then failed: ${error.message}` }
    inserted += chunk.length
  }
  return { ok: true, batchId, inserted }
}
