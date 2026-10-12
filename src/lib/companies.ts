import { supabase } from '@/lib/supabase'

/**
 * Multi-tenant company backbone for the Processor / Large-Offtaker dashboard.
 *
 * SECURITY-REVIEW: every read here is scoped server-side to the caller's own
 * memberships (RLS on `companies`, the `loamy_company_members_v` view's WHERE
 * clause). All writes go through SECURITY DEFINER RPCs that re-check
 * authorisation — there is no direct table write path from the client.
 */

export const COMPANY_ROLES = [
  'Procurement Director',
  'Procurement Manager',
  'Finance Officer',
  'Warehouse Manager',
  'Logistics Coordinator',
  'Quality Assurance Officer',
  'Executive Viewer',
] as const

export type CompanyRole = (typeof COMPANY_ROLES)[number]

export interface Company {
  id: string
  name: string
  cac_number: string | null
  rc_number: string | null
  business_address: string | null
  industry: string | null
  contact_person: string | null
  email: string | null
  phone: string | null
  logo_url: string | null
  tin: string | null
  verified: boolean
  verified_at: string | null
  created_by: string
  created_at: string
}

export interface CompanyMember {
  id: string
  company_id: string
  user_id: string
  company_role: CompanyRole
  is_owner: boolean
  joined_at: string
  full_name: string | null
  phone: string | null
}

export interface CompanyRegistration {
  name: string
  cac_number?: string
  rc_number?: string
  business_address?: string
  industry?: string
  contact_person?: string
  email?: string
  phone?: string
  tin?: string
}

/** The companies the signed-in user belongs to (usually one). */
export async function fetchMyCompanies(): Promise<Company[]> {
  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as Company[]
}

export async function fetchCompany(companyId: string): Promise<Company | null> {
  const { data, error } = await supabase.from('companies').select('*').eq('id', companyId).maybeSingle()
  if (error) throw error
  return (data as Company) ?? null
}

/** Register a company; the caller becomes its founding Procurement Director. */
export async function createCompany(reg: CompanyRegistration): Promise<string> {
  const { data, error } = await supabase.rpc('loamy_create_company', {
    p_name: reg.name,
    p_cac_number: reg.cac_number ?? null,
    p_rc_number: reg.rc_number ?? null,
    p_business_address: reg.business_address ?? null,
    p_industry: reg.industry ?? null,
    p_contact_person: reg.contact_person ?? null,
    p_email: reg.email ?? null,
    p_phone: reg.phone ?? null,
    p_tin: reg.tin ?? null,
  })
  if (error) throw error
  return data as string
}

export async function updateCompany(companyId: string, reg: CompanyRegistration & { logo_url?: string }): Promise<void> {
  const { error } = await supabase.rpc('loamy_update_company', {
    p_company_id: companyId,
    p_name: reg.name,
    p_cac_number: reg.cac_number ?? null,
    p_rc_number: reg.rc_number ?? null,
    p_business_address: reg.business_address ?? null,
    p_industry: reg.industry ?? null,
    p_contact_person: reg.contact_person ?? null,
    p_email: reg.email ?? null,
    p_phone: reg.phone ?? null,
    p_tin: reg.tin ?? null,
    p_logo_url: reg.logo_url ?? null,
  })
  if (error) throw error
}

export async function fetchCompanyMembers(companyId: string): Promise<CompanyMember[]> {
  const { data, error } = await supabase
    .from('loamy_company_members_v')
    .select('*')
    .eq('company_id', companyId)
    .order('is_owner', { ascending: false })
    .order('joined_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as CompanyMember[]
}

/** Add a teammate by their Loamy phone number (admins only). */
export async function addCompanyMember(companyId: string, phone: string, role: CompanyRole): Promise<void> {
  const { error } = await supabase.rpc('loamy_add_company_member', {
    p_company_id: companyId,
    p_phone: phone,
    p_company_role: role,
  })
  if (error) throw error
}

export async function updateMemberRole(companyId: string, userId: string, role: CompanyRole): Promise<void> {
  const { error } = await supabase.rpc('loamy_update_company_member_role', {
    p_company_id: companyId,
    p_user_id: userId,
    p_company_role: role,
  })
  if (error) throw error
}

export async function removeCompanyMember(companyId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('loamy_remove_company_member', {
    p_company_id: companyId,
    p_user_id: userId,
  })
  if (error) throw error
}

/** The caller's company_role in a company (null if not a member). */
export async function myCompanyRole(companyId: string): Promise<CompanyRole | null> {
  const { data, error } = await supabase.rpc('loamy_company_role', { target: companyId })
  if (error) throw error
  return (data as CompanyRole) ?? null
}

/** Can the caller administer this company (founder or Procurement Director)? */
export function canAdminRole(role: CompanyRole | null, isOwner: boolean): boolean {
  return isOwner || role === 'Procurement Director'
}
