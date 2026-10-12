import { supabase } from '@/lib/supabase'
import { PROCUREMENT_LIST_LIMIT } from '@/lib/limits'

/**
 * Inspection dispatch. Buyers request an inspection on an award; Loamy Growth
 * Partners in the territory claim and submit an on-site report (GPS + photos +
 * checklist, Stage-4 pattern). Evidence lives in the private inspection-evidence
 * bucket, reachable only via signed URLs the storage policy authorises.
 */

export type InspectionStatus = 'requested' | 'assigned' | 'in_progress' | 'submitted' | 'accepted' | 'disputed' | 'cancelled'
export type InspectionMode = 'loamy_partner' | 'company_inspector' | 'third_party'
export type Recommendation = 'pass' | 'fail' | 'conditional'

export interface InspectionJob {
  id: string
  award_id: string
  rfq_id: string
  company_id: string
  supplier_id: string
  mode: InspectionMode
  assigned_partner_id: string | null
  state: string | null
  lga: string | null
  location: string | null
  scheduled_for: string | null
  status: InspectionStatus
  findings: Record<string, unknown>
  photos: string[]
  gps_lat: number | null
  gps_lng: number | null
  quantity_verified: number | null
  quality_notes: string | null
  moisture_reading: number | null
  recommendation: Recommendation | null
  submitted_at: string | null
  reviewed_at: string | null
  review_note: string | null
  created_at: string
  rfq_reference: string
  commodity: string
  unit: string
  awarded_quantity: number
  partner_name: string | null
  supplier_name: string | null
}

export interface AvailableInspection {
  id: string
  rfq_id: string
  state: string | null
  lga: string | null
  location: string | null
  scheduled_for: string | null
  created_at: string
  rfq_reference: string
  commodity: string
  unit: string
  awarded_quantity: number
}

export interface InspectionSubmission {
  photos?: string[]
  gps_lat?: number | null
  gps_lng?: number | null
  quantity_verified?: number | null
  quality_notes?: string | null
  moisture_reading?: number | null
  recommendation?: Recommendation | null
  findings?: Record<string, unknown>
}

// ---- Buyer side -------------------------------------------------------------

export async function fetchCompanyInspections(): Promise<InspectionJob[]> {
  const { data, error } = await supabase.from('loamy_inspection_jobs_v').select('*')
    .order('created_at', { ascending: false }).order('id', { ascending: true })
    .limit(PROCUREMENT_LIST_LIMIT)
  if (error) throw error
  return (data ?? []) as InspectionJob[]
}

export async function fetchInspectionForAward(awardId: string): Promise<InspectionJob | null> {
  const { data, error } = await supabase.from('loamy_inspection_jobs_v').select('*').eq('award_id', awardId).order('created_at', { ascending: false }).limit(1)
  if (error) throw error
  return (data?.[0] as InspectionJob) ?? null
}

export async function requestInspection(awardId: string, location?: string | null, scheduledFor?: string | null): Promise<string> {
  const { data, error } = await supabase.rpc('loamy_request_inspection', {
    p_award_id: awardId, p_location: location ?? null, p_scheduled_for: scheduledFor ?? null,
  })
  if (error) throw error
  return data as string
}

export async function reviewInspection(jobId: string, accept: boolean, note?: string): Promise<void> {
  const { error } = await supabase.rpc('loamy_review_inspection', { p_job_id: jobId, p_accept: accept, p_note: note ?? null })
  if (error) throw error
}

// ---- Partner side -----------------------------------------------------------

export async function fetchAvailableInspections(): Promise<AvailableInspection[]> {
  const { data, error } = await supabase.from('loamy_available_inspections').select('*')
    .order('created_at', { ascending: false }).order('id', { ascending: true })
    .limit(PROCUREMENT_LIST_LIMIT)
  if (error) throw error
  return (data ?? []) as AvailableInspection[]
}

export async function fetchMyAssignedInspections(): Promise<InspectionJob[]> {
  const { data: u } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('loamy_inspection_jobs_v').select('*').eq('assigned_partner_id', u.user?.id ?? '')
    .order('created_at', { ascending: false }).order('id', { ascending: true })
    .limit(PROCUREMENT_LIST_LIMIT)
  if (error) throw error
  return (data ?? []) as InspectionJob[]
}

export async function claimInspection(jobId: string): Promise<void> {
  const { error } = await supabase.rpc('loamy_claim_inspection', { p_job_id: jobId })
  if (error) throw error
}

export async function submitInspection(jobId: string, s: InspectionSubmission): Promise<void> {
  const { error } = await supabase.rpc('loamy_submit_inspection', {
    p_job_id: jobId,
    p_findings: s.findings ?? {},
    p_photos: s.photos ?? [],
    p_gps_lat: s.gps_lat ?? null,
    p_gps_lng: s.gps_lng ?? null,
    p_quantity_verified: s.quantity_verified ?? null,
    p_quality_notes: s.quality_notes ?? null,
    p_moisture_reading: s.moisture_reading ?? null,
    p_recommendation: s.recommendation ?? null,
  })
  if (error) throw error
}

/** Upload an evidence photo to the private bucket; returns its object path. */
export async function uploadInspectionPhoto(jobId: string, file: File): Promise<string> {
  const safe = file.name.replace(/[^\w.\-]+/g, '_')
  const path = `${jobId}/${Date.now()}_${safe}`
  const { error } = await supabase.storage.from('inspection-evidence').upload(path, file, { upsert: false })
  if (error) throw error
  return path
}

export async function inspectionPhotoUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from('inspection-evidence').createSignedUrl(path, 60 * 10)
  if (error) return null
  return data.signedUrl
}
