import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { BadgeCheck, Building2, CircleDashed, Pencil, ShieldQuestion } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import {
  canAdminRole, createCompany, fetchCompanyMembers, fetchMyCompanies, updateCompany,
  type Company, type CompanyRegistration,
} from '@/lib/companies'
import { formatDateShort } from '@/lib/utils'
import { DashboardCard } from '@/components/DashboardCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useT } from '@/lib/i18n'

/**
 * Industries offered in the registration select.
 *
 * The left-hand string is what is WRITTEN TO `companies.industry`, so it stays
 * English in the database and in every export; only the label a member reads is
 * translated. An industry already stored by an older build, or one this list no
 * longer offers, falls through `industryLabel` and renders its own stored text
 * rather than a key.
 */
const INDUSTRIES: { value: string; slug: string }[] = [
  { value: 'Flour milling', slug: 'flourMilling' },
  { value: 'Rice milling', slug: 'riceMilling' },
  { value: 'Feed / poultry', slug: 'feedPoultry' },
  { value: 'Oil processing', slug: 'oilProcessing' },
  { value: 'Brewing / malting', slug: 'brewingMalting' },
  { value: 'Food & beverage', slug: 'foodBeverage' },
  { value: 'Export / aggregation', slug: 'exportAggregation' },
  { value: 'Confectionery', slug: 'confectionery' },
  { value: 'Other processing', slug: 'otherProcessing' },
]

/** The reader's label for a stored industry value, falling back to the value. */
function useIndustryLabel() {
  const { tOr } = useT()
  return (value: string) => {
    const match = INDUSTRIES.find((i) => i.value === value)
    return match ? tOr(`processor.industry.${match.slug}`, match.value) : value
  }
}

const EMPTY: CompanyRegistration = { name: '' }

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-emerald-900/45">{label}</p>
      <p className="mt-0.5 text-sm text-emerald-950">{value?.trim() || '-'}</p>
    </div>
  )
}

/**
 * Company section: register a company (if none) or view/edit the company
 * profile. The founder and any Procurement Director may edit; everyone else on
 * the team sees a read-only profile. Verification is an honest state set by
 * admins — never self-asserted.
 */
export default function CompanyHub() {
  const { t } = useT()
  const industryLabel = useIndustryLabel()
  const { profile, flagEnabled } = useAuth()
  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(true)
  const [canAdmin, setCanAdmin] = useState(false)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<CompanyRegistration>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useMemo(() => async () => {
    setLoading(true)
    try {
      const cos = await fetchMyCompanies()
      const co = cos[0] ?? null
      setCompany(co)
      if (co) {
        const members = await fetchCompanyMembers(co.id)
        const me = members.find((m) => m.user_id === profile?.id)
        setCanAdmin(canAdminRole(me?.company_role ?? null, me?.is_owner ?? false))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('processor.company.couldNotLoad'))
    } finally {
      setLoading(false)
    }
  }, [profile?.id])

  useEffect(() => { void load() }, [load])

  function startEdit(co: Company) {
    setForm({
      name: co.name, cac_number: co.cac_number ?? '', rc_number: co.rc_number ?? '',
      business_address: co.business_address ?? '', industry: co.industry ?? '',
      contact_person: co.contact_person ?? '', email: co.email ?? '', phone: co.phone ?? '',
      tin: co.tin ?? '',
    })
    setEditing(true)
    setError(null)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!form.name.trim()) { setError(t('processor.company.nameRequired')); return }
    setBusy(true)
    try {
      if (company) {
        await updateCompany(company.id, form)
      } else {
        await createCompany(form)
      }
      setEditing(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('processor.company.couldNotSave'))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div className="h-40 animate-pulse rounded bg-emerald-50" aria-label={t('processor.company.loading')} />
  }

  // Registration / edit form
  if (!company || editing) {
    const set = (k: keyof CompanyRegistration) => (v: string) => setForm((f) => ({ ...f, [k]: v }))
    return (
      <div className="mx-auto max-w-2xl">
        <DashboardCard title={company ? t('processor.company.editProfile') : t('processor.company.registerYourCompany')}>
          {!company && (
            <p className="mb-4 text-[13px] leading-relaxed text-emerald-900/60">
              {t('processor.overview.registerPrompt')}
              You become the company’s Procurement Director and can invite your team afterward.
            </p>
          )}
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label htmlFor="name">{t('processor.company.name')}</Label>
              <Input id="name" value={form.name} onChange={(e) => set('name')(e.target.value)}
                placeholder={t('processor.company.namePlaceholder')} required />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="rc">{t('processor.company.rcNumber')}</Label>
                <Input id="rc" value={form.rc_number ?? ''} onChange={(e) => set('rc_number')(e.target.value)}
                  placeholder={t('processor.company.rcPlaceholder')} />
              </div>
              <div>
                <Label htmlFor="cac">{t('processor.company.cacNumber')}</Label>
                <Input id="cac" value={form.cac_number ?? ''} onChange={(e) => set('cac_number')(e.target.value)}
                  placeholder={t('processor.company.cacPlaceholder')} />
              </div>
            </div>
            <div>
              <Label htmlFor="industry">{t('processor.company.industry')}</Label>
              <select id="industry" value={form.industry ?? ''} onChange={(e) => set('industry')(e.target.value)}
                className="flex h-10 min-h-touch w-full rounded border border-line bg-white px-3 text-sm text-emerald-950 focus:outline-none focus:ring-2 focus:ring-emerald-600/30">
                <option value="">{t('processor.company.selectIndustry')}</option>
                {INDUSTRIES.map((i) => <option key={i.value} value={i.value}>{industryLabel(i.value)}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="addr">{t('processor.company.address')}</Label>
              <Textarea id="addr" value={form.business_address ?? ''} onChange={(e) => set('business_address')(e.target.value)}
                placeholder={t('processor.company.addressPlaceholder')} rows={2} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="contact">{t('processor.company.contactPerson')}</Label>
                <Input id="contact" value={form.contact_person ?? ''} onChange={(e) => set('contact_person')(e.target.value)}
                  placeholder={t('processor.company.contactPlaceholder')} />
              </div>
              <div>
                <Label htmlFor="phone">{t('processor.company.phone')}</Label>
                <Input id="phone" value={form.phone ?? ''} onChange={(e) => set('phone')(e.target.value)}
                  placeholder={t('processor.company.phonePlaceholder')} />
              </div>
              <div>
                <Label htmlFor="email">{t('processor.company.email')}</Label>
                <Input id="email" type="email" value={form.email ?? ''} onChange={(e) => set('email')(e.target.value)}
                  placeholder={t('processor.company.emailPlaceholder')} />
              </div>
              <div>
                <Label htmlFor="tin">{t('processor.company.tin')} <span className="text-emerald-900/40">{t('processor.company.optional')}</span></Label>
                <Input id="tin" value={form.tin ?? ''} onChange={(e) => set('tin')(e.target.value)}
                  placeholder={t('processor.company.taxId')} />
              </div>
            </div>

            {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {busy ? t('common.saving') : company ? t('processor.company.saveChanges') : t('processor.overview.registerCompany')}
              </Button>
              {company && (
                <Button type="button" variant="ghost" onClick={() => { setEditing(false); setError(null) }}>{t('common.cancel')}</Button>
              )}
            </div>
          </form>
        </DashboardCard>
      </div>
    )
  }

  // Read-only / admin profile view
  return (
    <div className="space-y-5">
      <DashboardCard
        title={t('processor.company.profile')}
        action={canAdmin ? (
          <Button size="sm" variant="ghost" onClick={() => startEdit(company)}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden /> {t('processor.company.edit')}
          </Button>
        ) : undefined}
      >
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded border border-line bg-emerald-50 text-emerald-700">
            <Building2 className="h-7 w-7" strokeWidth={1.5} aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-emerald-950">{company.name}</h3>
              {company.verified ? (
                <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                  <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> {t('processor.company.verified')}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                  <CircleDashed className="h-3.5 w-3.5" aria-hidden /> {t('processor.company.unverified')}
                </span>
              )}
            </div>
            {company.industry && <p className="mt-0.5 text-sm text-emerald-900/60">{industryLabel(company.industry)}</p>}
            <p className="mt-1 text-[11px] text-emerald-900/45">
              {t('processor.company.registeredOn', { date: formatDateShort(company.created_at) })}
              {company.verified_at && t('processor.company.verifiedOn', { date: formatDateShort(company.verified_at) })}
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t('processor.company.rcNumber')} value={company.rc_number} />
          <Field label={t('processor.company.cacNumber')} value={company.cac_number} />
          <Field label={t('processor.company.tin')} value={company.tin} />
          <Field label={t('processor.company.contactPerson')} value={company.contact_person} />
          <Field label={t('processor.company.phoneLabel')} value={company.phone} />
          <Field label={t('processor.company.emailLabel')} value={company.email} />
          <div className="sm:col-span-2 lg:col-span-3">
            <Field label={t('processor.company.address')} value={company.business_address} />
          </div>
        </div>
      </DashboardCard>

      {/* Identity verification is intentionally not live. Built behind the
          processor_kyc flag (OFF) — no NIN/BVN/face capture path exists yet. */}
      {flagEnabled('processor_kyc') && (
        <DashboardCard title={t('processor.company.verification')}>
          <div className="flex items-start gap-2.5 text-[13px] text-emerald-900/60">
            <ShieldQuestion className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden />
            <p>{t('processor.company.verificationPending')}</p>
          </div>
        </DashboardCard>
      )}
    </div>
  )
}
