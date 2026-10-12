import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { BadgeCheck, Camera, ExternalLink, KeyRound, ShieldAlert, UserRound } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { isKycProviderConfigured } from '@/lib/providers/kyc'
import { NIGERIA_STATES } from '@/lib/nigeria'
import { initials } from '@/lib/utils'
import { DashboardCard } from '@/components/DashboardCard'
import { MyRoles } from '@/components/MyRoles'
import { UsernameCard } from '@/components/UsernameCard'
import { isInstitutionalProfile } from '@/lib/roles'
import { useT } from '@/lib/i18n'
import { LanguageSelector } from '@/components/LanguageSelector'
import { PayoutAccountCard } from '@/components/PayoutAccountCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

/** What a public profile will actually display. Keeps the editor honest. */
const HEADLINE_MAX = 120
const BIO_MAX = 600

/**
 * Profile + account settings. Collects ONLY low-sensitivity fields (name,
 * phone, avatar, handle, headline, bio, state).
 *
 * WHY headline / bio / state WERE ADDED (§14)
 *   All three are rendered on /u/:username and all three were editable
 *   NOWHERE. The privacy policy even promises "a headline and a short bio, if
 *   you choose to add them" — a promise the product could not keep, because
 *   there was no control anywhere that wrote those columns. A field a member
 *   can see on their own public page but cannot change is worse than a field
 *   that does not exist.
 *
 *   They are ordinary owner-writable columns: the guard triggers freeze
 *   verified_badge, the KYC flags and username, not these. So the existing
 *   owner-scoped update is the right path and no new RPC was needed.
 *
 * WHAT IS NOT HERE
 *   Phone stays on the account side and is NOT part of the public payload —
 *   loamy_profile_by_username never returns it. Nothing in this editor writes
 *   a field the public profile is not already entitled to show.
 *
 * BVN and NIN are not collected here and cannot be: the columns that once
 * held them were dropped in migration 20260919270001. Loamy does not store a
 * BVN anywhere — the bank collects it directly.
 */
export default function Settings() {
  const { t, saveState } = useT()
  const { profile, session, refreshProfile } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)

  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const [headline, setHeadline] = useState(profile?.headline ?? '')
  const [bio, setBio] = useState(profile?.bio ?? '')
  const [state, setState] = useState(profile?.state ?? '')
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [savingProfile, setSavingProfile] = useState(false)
  const [uploading, setUploading] = useState(false)

  // Dirty state, so Save is inert until there is something to save and the
  // success message cannot linger over unsaved edits.
  const dirty =
    fullName !== (profile?.full_name ?? '') ||
    phone !== (profile?.phone ?? '') ||
    headline !== (profile?.headline ?? '') ||
    bio !== (profile?.bio ?? '') ||
    state !== (profile?.state ?? '')

  function edit<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setProfileMsg(null) }
  }

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordMsg, setPasswordMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [savingPassword, setSavingPassword] = useState(false)

  async function saveProfile(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    setProfileMsg(null)
    if (!fullName.trim()) {
      setProfileMsg({ ok: false, text: 'Name cannot be empty.' })
      return
    }
    if (headline.trim().length > HEADLINE_MAX) {
      setProfileMsg({ ok: false, text: `Headline must be ${HEADLINE_MAX} characters or fewer.` })
      return
    }
    if (bio.trim().length > BIO_MAX) {
      setProfileMsg({ ok: false, text: `About must be ${BIO_MAX} characters or fewer.` })
      return
    }
    setSavingProfile(true)
    // Empty is stored as NULL, not as "". The public profile renders a
    // section only when the field has content, and an empty string would
    // render an empty section.
    const blank = (v: string) => (v.trim() === '' ? null : v.trim())
    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: fullName.trim(),
        phone: phone.trim(),
        headline: blank(headline),
        bio: blank(bio),
        state: blank(state),
      })
      .eq('id', profile.id)
    setSavingProfile(false)
    if (error) {
      setProfileMsg({ ok: false, text: error.message })
      return
    }
    // Refresh BEFORE confirming: the message claims the saved state is now
    // what the app holds, so the app has to actually hold it.
    await refreshProfile()
    setProfileMsg({
      ok: true,
      text: profile.username
        ? 'Saved. Your public profile now shows these details.'
        : 'Saved.',
    })
  }

  async function uploadAvatar(file: File) {
    if (!profile) return
    setProfileMsg(null)
    if (!file.type.startsWith('image/')) {
      setProfileMsg({ ok: false, text: 'Please choose an image file.' })
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setProfileMsg({ ok: false, text: 'Image must be under 2 MB.' })
      return
    }
    setUploading(true)
    // Storage policy allows writes ONLY under the caller's own {uid}/ folder.
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
    const path = `${profile.id}/avatar-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    })
    if (upErr) {
      setUploading(false)
      setProfileMsg({ ok: false, text: upErr.message })
      return
    }
    const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
    const { error: updErr } = await supabase
      .from('profiles')
      .update({ avatar_url: pub.publicUrl })
      .eq('id', profile.id)
    setUploading(false)
    if (updErr) {
      setProfileMsg({ ok: false, text: updErr.message })
      return
    }
    await refreshProfile()
    setProfileMsg({ ok: true, text: 'Profile photo updated.' })
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault()
    setPasswordMsg(null)
    if (newPassword.length < 8) {
      setPasswordMsg({ ok: false, text: 'Password must be at least 8 characters.' })
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ ok: false, text: 'Passwords do not match.' })
      return
    }
    setSavingPassword(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setSavingPassword(false)
    if (error) {
      setPasswordMsg({ ok: false, text: error.message })
      return
    }
    setNewPassword('')
    setConfirmPassword('')
    setPasswordMsg({ ok: true, text: 'Password changed.' })
  }

  const msg = (m: { ok: boolean; text: string } | null) =>
    m && (
      <p role={m.ok ? 'status' : 'alert'} className={m.ok ? 'rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800' : 'rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700'}>
        {m.text}
      </p>
    )

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {/* A public @handle is marketplace identity: it is how a buyer finds a
          seller. A bank officer and a platform administrator have no shopfront,
          so the card is not rendered for them at all. This is a real
          conditional, not a CSS hide: the component never mounts, so it issues
          no availability lookups either. */}
      {!isInstitutionalProfile(profile) && (
        <UsernameCard
          current={profile?.username ?? null}
          currentVisibility={profile?.profile_visibility ?? 'members'}
          onSaved={() => void refreshProfile()}
        />
      )}

      {/* Language. The same control the footer uses, so the two can never
          disagree about which languages exist or how selection behaves. The
          status line reports what actually happened: the interface changes
          either way, but only a successful write follows the member to another
          device, and saying "saved" when the write failed would be a lie. */}
      <DashboardCard title={t('settings.language')}>
        <div className="space-y-3">
          <LanguageSelector variant="settings" />
          <p className="text-[13px] leading-snug text-emerald-900/60">
            {t('settings.languageHelp')}
          </p>
          {saveState === 'saved' && (
            <p role="status" className="text-[13px] font-medium text-emerald-800">
              {t('settings.languageSaved')}
            </p>
          )}
          {saveState === 'error' && (
            <p role="alert" className="text-[13px] font-medium text-rose-800">
              {t('settings.languageSaveFailed')}
            </p>
          )}
        </div>
      </DashboardCard>

      <PayoutAccountCard />

      <DashboardCard title={t('settings.profile')}>
        <form onSubmit={saveProfile} className="space-y-4" noValidate>
          <div className="flex items-center gap-4">
            <div className="relative">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="Your profile" className="h-16 w-16 rounded-full object-cover ring-2 ring-emerald-100" />
              ) : (
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-800 text-lg font-bold text-white">
                  {initials(profile?.full_name)}
                </span>
              )}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                /* h-9: the avatar overlay was a 28px target, which is the
                   hardest kind to hit — small AND overlapping an image. */
                className="absolute -bottom-1 -right-1 flex h-9 w-9 min-h-touch min-w-touch items-center justify-center rounded-full bg-gold-400 text-emerald-950 shadow-sm transition-colors hover:bg-gold-300 disabled:opacity-50"
                aria-label={t('settings.changePhoto')}
              >
                <Camera className="h-4 w-4" aria-hidden />
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void uploadAvatar(f)
                  e.target.value = ''
                }}
              />
            </div>
            <div className="text-sm">
              <p className="font-semibold text-emerald-950">{profile?.full_name}</p>
              <p className="font-mono text-xs text-emerald-900/55">{profile?.digital_id}</p>
              <p className="text-xs text-emerald-900/45">{session?.user.email}</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="set_name">{t('settings.fullName')}</Label>
              <Input id="set_name" value={fullName} onChange={(e) => edit(setFullName)(e.target.value)} />
              <p className="mt-1 text-[11px] text-emerald-900/45">
                Shown on your public profile and to people you trade with.
              </p>
            </div>
            <div>
              <Label htmlFor="set_phone">{t('settings.phone')}</Label>
              <Input id="set_phone" type="tel" value={phone} onChange={(e) => edit(setPhone)(e.target.value)} />
              {/* Said explicitly, because a phone number on a profile page is
                  exactly what a member would fear. It is not in the public
                  payload at all. */}
              <p className="mt-1 text-[11px] text-emerald-900/45">
                Never shown publicly. Shared only with a counterparty once you both agree to trade.
              </p>
            </div>
            <div>
              <Label htmlFor="set_state">{t('settings.state')}</Label>
              <Select id="set_state" value={state} onChange={(e) => edit(setState)(e.target.value)}>
                <option value="">Not set</option>
                {NIGERIA_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
              <p className="mt-1 text-[11px] text-emerald-900/45">
                State only. Loamy never shows your exact address or farm location publicly.
              </p>
            </div>
            <div>
              <Label htmlFor="set_headline">{t('settings.headline')}</Label>
              <Input
                id="set_headline"
                value={headline}
                maxLength={HEADLINE_MAX}
                onChange={(e) => edit(setHeadline)(e.target.value)}
                placeholder="Aggregating maize from verified farms in Kaduna"
              />
              <p className="mt-1 text-[11px] text-emerald-900/45">
                One line under your name. {HEADLINE_MAX - headline.length} characters left.
              </p>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="set_bio">{t('settings.bio')}</Label>
              <Textarea
                id="set_bio"
                value={bio}
                rows={4}
                maxLength={BIO_MAX}
                onChange={(e) => edit(setBio)(e.target.value)}
                placeholder="What you trade, where you operate, and how you work."
              />
              <p className="mt-1 text-[11px] text-emerald-900/45">
                Appears as the About section on your public profile. {BIO_MAX - bio.length} characters left.
              </p>
            </div>
          </div>
          {msg(profileMsg)}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={savingProfile} disabled={!dirty}>
              <UserRound className="h-4 w-4" aria-hidden /> Save profile
            </Button>
            {/* The round trip §2 asks for: edit here, then go and look at what
                a visitor sees. Only offered once a handle exists, because
                without one there is no public URL. */}
            {profile?.username && (
              <Link
                to={`/u/${profile.username}`}
                className="inline-flex h-10 items-center gap-1.5 rounded-control border border-clay bg-white px-4 text-[13px] font-semibold text-emerald-900 hover:bg-sand"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden /> View public profile
              </Link>
            )}
            {dirty && (
              <span className="text-[12px] text-emerald-900/50">Unsaved changes</span>
            )}
          </div>
        </form>
      </DashboardCard>

      <MyRoles />

      <DashboardCard title={t('settings.identityVerification')}>
        {/* KYC verified-STATUS only. The raw BVN/NIN is never collected or
            stored here; verification runs through a provider-hosted capture in
            Phase 2, gated on the engineer's encryption-at-rest sign-off. */}
        <div className="space-y-2.5">
          {(['BVN', 'NIN'] as const).map((f) => {
            const verified = f === 'BVN' ? profile?.bvn_verified : profile?.nin_verified
            return (
              <div key={f} className="flex items-center justify-between gap-3 rounded border border-line px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-emerald-950">{f}</p>
                  <p className="text-[11px] text-emerald-900/50">
                    {f === 'BVN' ? 'Bank Verification Number' : 'National Identification Number'} - status only; your number is never stored on Loamy.
                  </p>
                </div>
                {verified ? (
                  <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                    <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Verified
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded bg-emerald-950/5 px-1.5 py-0.5 text-xs font-medium text-emerald-900/55">
                    <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> Not verified
                  </span>
                )}
              </div>
            )
          })}
          <p className="text-[11px] leading-relaxed text-emerald-900/50">
            {isKycProviderConfigured()
              ? 'Verification is available through our identity provider - you will be guided through a secure capture; Loamy only records the result.'
              : 'Identity verification opens once the licensed provider is connected. Capture is provider-hosted, so your BVN and NIN never reach Loamy.'}
          </p>
        </div>
      </DashboardCard>

      <DashboardCard title={t('settings.password')}>
        <form onSubmit={changePassword} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="set_pw">{t('settings.newPassword')}</Label>
              <Input id="set_pw" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 8 characters" />
            </div>
            <div>
              <Label htmlFor="set_pw2">{t('settings.confirmPassword')}</Label>
              <Input id="set_pw2" type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </div>
          </div>
          {msg(passwordMsg)}
          <Button type="submit" variant="outline" loading={savingPassword}>
            <KeyRound className="h-4 w-4" aria-hidden /> Change password
          </Button>
        </form>
      </DashboardCard>
    </div>
  )
}
