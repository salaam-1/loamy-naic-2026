import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Crown, Plus, Trash2, UserRound } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import {
  addCompanyMember, canAdminRole, COMPANY_ROLES, fetchCompanyMembers, fetchMyCompanies,
  removeCompanyMember, updateMemberRole, type CompanyMember, type CompanyRole,
} from '@/lib/companies'
import { formatDateShort } from '@/lib/utils'
import { DashboardCard } from '@/components/DashboardCard'
import { EmptyState } from '@/components/EmptyState'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useT } from '@/lib/i18n'

/**
 * Role vocabulary. The key on the left is the DB's own `company_role` value and
 * decides permissions; it is never translated. `label` is what a member reads
 * and `help` explains the permission, and both go through `tOr` so a language
 * the pack has not reached yet still renders the English rather than a key.
 */
const ROLE_COPY: Record<CompanyRole, { slug: string; label: string; help: string }> = {
  'Procurement Director': { slug: 'procurementDirector', label: 'Procurement Director', help: 'Full access - manage the company, team, buy requests, awards, and payments.' },
  'Procurement Manager': { slug: 'procurementManager', label: 'Procurement Manager', help: 'Create buy requests, review bids, and recommend awards.' },
  'Finance Officer': { slug: 'financeOfficer', label: 'Finance Officer', help: 'Fund escrow and manage payments and settlement.' },
  'Warehouse Manager': { slug: 'warehouseManager', label: 'Warehouse Manager', help: 'Confirm receipt, manage warehouse reservations and grading.' },
  'Logistics Coordinator': { slug: 'logisticsCoordinator', label: 'Logistics Coordinator', help: 'Arrange transport and track deliveries.' },
  'Quality Assurance Officer': { slug: 'qualityAssuranceOfficer', label: 'Quality Assurance Officer', help: 'Request and review inspections before release.' },
  'Executive Viewer': { slug: 'executiveViewer', label: 'Executive Viewer', help: 'Read-only visibility across procurement activity.' },
}

/**
 * Company team roster with role-based access. The founder and any Procurement
 * Director may invite teammates (by their Loamy phone number), change roles, and
 * remove members. The founder (owner) can never be removed or demoted.
 */
export default function CompanyTeam() {
  const { t, tOr, tPlural } = useT()
  const roleLabel = (r: CompanyRole) => tOr(`processor.team.role.${ROLE_COPY[r].slug}`, ROLE_COPY[r].label)
  const { profile } = useAuth()
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [members, setMembers] = useState<CompanyMember[]>([])
  const [loading, setLoading] = useState(true)
  const [canAdmin, setCanAdmin] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Add-member modal
  const [addOpen, setAddOpen] = useState(false)
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<CompanyRole>('Procurement Manager')
  const [busy, setBusy] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)

  // Remove confirm
  const [toRemove, setToRemove] = useState<CompanyMember | null>(null)

  const load = useMemo(() => async () => {
    setLoading(true)
    try {
      const cos = await fetchMyCompanies()
      const co = cos[0]
      if (!co) { setCompanyId(null); setMembers([]); return }
      setCompanyId(co.id)
      const rows = await fetchCompanyMembers(co.id)
      setMembers(rows)
      const me = rows.find((m) => m.user_id === profile?.id)
      setCanAdmin(canAdminRole(me?.company_role ?? null, me?.is_owner ?? false))
    } catch (e) {
      setError(e instanceof Error ? e.message : t('processor.team.couldNotLoad'))
    } finally {
      setLoading(false)
    }
  }, [profile?.id])

  useEffect(() => { void load() }, [load])

  async function onAdd(e: FormEvent) {
    e.preventDefault()
    if (!companyId) return
    setModalError(null)
    if (!phone.trim()) { setModalError(t('processor.team.enterPhone')); return }
    setBusy(true)
    try {
      await addCompanyMember(companyId, phone.trim(), role)
      setAddOpen(false); setPhone(''); setRole('Procurement Manager')
      await load()
    } catch (e) {
      setModalError(e instanceof Error ? e.message : t('processor.team.couldNotAdd'))
    } finally {
      setBusy(false)
    }
  }

  async function onChangeRole(m: CompanyMember, next: CompanyRole) {
    if (!companyId || next === m.company_role) return
    try {
      await updateMemberRole(companyId, m.user_id, next)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('processor.team.couldNotChangeRole'))
    }
  }

  async function onRemove() {
    if (!companyId || !toRemove) return
    setBusy(true)
    try {
      await removeCompanyMember(companyId, toRemove.user_id)
      setToRemove(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('processor.team.couldNotRemove'))
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="h-40 animate-pulse rounded bg-emerald-50" aria-label={t('processor.team.loading')} />

  if (!companyId) {
    return (
      <EmptyState
        icon={UserRound}
        title={t('processor.team.registerFirst')}
        body={t('processor.team.registerFirstBody')}
      />
    )
  }

  return (
    <div className="space-y-5">
      {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <DashboardCard
        title={tPlural('processor.team.title', members.length, { count: members.length })}
        action={canAdmin ? (
          <Button size="sm" onClick={() => { setAddOpen(true); setModalError(null) }}>
            <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden /> {t('processor.team.addMember')}
          </Button>
        ) : undefined}
      >
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
              <th className="py-2 pr-4 font-medium">{t('processor.team.colMember')}</th>
              <th className="py-2 pr-4 font-medium">{t('processor.team.colRole')}</th>
              <th className="py-2 pr-4 font-medium">{t('processor.team.colJoined')}</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {members.map((m) => {
              const isMe = m.user_id === profile?.id
              return (
                <tr key={m.id}>
                  <td className="py-2.5 pr-4">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-emerald-950">{m.full_name?.trim() || t('processor.team.loamyMember')}</span>
                      {m.is_owner && <Crown className="h-3.5 w-3.5 text-[#C8A045]" aria-label={t('processor.team.owner')} />}
                      {isMe && <span className="text-[11px] text-emerald-900/45">{t('processor.team.you')}</span>}
                    </div>
                    <span className="font-mono text-[12px] text-emerald-900/50">{m.phone ?? '-'}</span>
                  </td>
                  <td className="py-2.5 pr-4">
                    {canAdmin && !m.is_owner ? (
                      <select
                        value={m.company_role}
                        onChange={(e) => onChangeRole(m, e.target.value as CompanyRole)}
                        className="h-8 min-h-touch rounded border border-line bg-white px-2 text-[13px] text-emerald-950 focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
                      >
                        {COMPANY_ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                      </select>
                    ) : (
                      <span className="text-emerald-900/80">{roleLabel(m.company_role)}</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-[13px] text-emerald-900/55">{formatDateShort(m.joined_at)}</td>
                  <td className="py-2.5 text-right">
                    {canAdmin && !m.is_owner && (
                      <button
                        type="button"
                        onClick={() => setToRemove(m)}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-[13px] text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden /> {t('processor.team.remove')}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </DashboardCard>

      <p className="text-[11px] leading-relaxed text-emerald-900/45">
        {t('processor.team.footnote')}
      </p>

      {/* Add member */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title={t('processor.team.addTitle')}>
        <form onSubmit={onAdd} className="space-y-4">
          <div>
            <Label htmlFor="mphone">{t('processor.team.theirPhone')}</Label>
            <Input id="mphone" value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder={t('processor.team.phonePlaceholder')} autoFocus />
            <p className="mt-1 text-[11px] text-emerald-900/45">{t('processor.team.mustHaveAccount')}</p>
          </div>
          <div>
            <Label htmlFor="mrole">{t('processor.team.colRole')}</Label>
            <select id="mrole" value={role} onChange={(e) => setRole(e.target.value as CompanyRole)}
              className="flex h-10 min-h-touch w-full rounded border border-line bg-white px-3 text-sm text-emerald-950 focus:outline-none focus:ring-2 focus:ring-emerald-600/30">
              {COMPANY_ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </select>
            <p className="mt-1 text-[11px] leading-snug text-emerald-900/50">{tOr(`processor.team.roleHelp.${ROLE_COPY[role].slug}`, ROLE_COPY[role].help)}</p>
          </div>
          {modalError && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{modalError}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>{busy ? t('processor.team.adding') : t('processor.team.addMember')}</Button>
            <Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>{t('common.cancel')}</Button>
          </div>
        </form>
      </Modal>

      {/* Remove confirm */}
      <Modal open={!!toRemove} onClose={() => setToRemove(null)} title={t('processor.team.removeTitle')}>
        <p className="text-sm text-emerald-900/70">
          {t('processor.team.removeBody', {
            name: toRemove?.full_name?.trim() || t('processor.team.thisMember'),
          })}
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" className="!text-red-700 !border-red-200 hover:!bg-red-50" onClick={onRemove} disabled={busy}>
            {busy ? t('processor.team.removing') : t('processor.team.remove')}
          </Button>
          <Button variant="ghost" onClick={() => setToRemove(null)}>{t('common.cancel')}</Button>
        </div>
      </Modal>
    </div>
  )
}
