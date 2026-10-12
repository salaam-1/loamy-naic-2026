import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Gift, Info, Share2, Sparkles, UserPlus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  BENEFIT_KIND_LABEL, REFERRAL_STATE,
  benefitsHeadline, qualificationLabel, referralUrl,
  type Benefit, type ReferralStatus, type ReferralSummary,
} from '@/lib/referrals'
import { cn } from '@/lib/utils'

const TONE = {
  good: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  busy: 'border-emerald-300 bg-white text-emerald-800',
  idle: 'border-line bg-emerald-900/[0.03] text-emerald-900/45',
  bad: 'border-rose-200 bg-rose-50 text-rose-800',
}

/**
 * Invite & Benefits (route: /dashboard/:role/invite).
 *
 * The ordinary member's referral surface. It shows NO money — not a total,
 * not a zero, not a currency symbol. Loamy referrals earn platform benefits;
 * Growth Partner commission is a separate programme on a separate page, and
 * mixing them would tell members they are owed something they are not.
 */
/*
 * NOTE: this renders NO shell of its own.
 *
 * It is reached only through RoleDashboard, which already wraps every
 * section in AppShell. Wrapping again in RoleShell (which is itself an
 * AppShell) nested two shells and painted TWO complete Loamy headers,
 * one directly above the other, on mobile. RoleShell is for DEEP ROUTES
 * that are not inside RoleDashboard, such as the listing detail and
 * editor, and those keep it.
 *
 * No authorization is lost: RoleDashboard enforces the auth guard and the
 * section role list, and this call site never passed allowedRoles.
 */
export default function InviteBenefits() {
  const [summary, setSummary] = useState<ReferralSummary | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [justQualified, setJustQualified] = useState(0)

  const load = useCallback(async () => {
    // Re-evaluate first, THEN read. A referral qualifies when the person who
    // joined actually does something -- completes their first transaction,
    // gets a farm verified -- and nothing on the platform was re-checking
    // that. Reading the summary alone would show a referral stuck at
    // 'registered' forever and a benefit that never unlocked, with no way for
    // the member to find out why. loamy_check_my_referrals only promotes
    // referrals that already meet the programme's own rule; it cannot invent
    // a qualification.
    const { data: checked } = await supabase.rpc('loamy_check_my_referrals')
    const promoted = Number((checked as { newly_qualified?: number } | null)?.newly_qualified ?? 0)
    if (promoted > 0) {
      setJustQualified(promoted)
    }
    const { data } = await supabase.rpc('loamy_my_referral_summary')
    setSummary((data as ReferralSummary) ?? null)
  }, [])

  useEffect(() => { void load() }, [load])

  const link = referralUrl(
    typeof window !== 'undefined' ? window.location.origin : '',
    summary?.code?.link_path,
  )

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked. The link is on screen and selectable, which is
      // the fallback that always works.
    }
  }

  async function share() {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> }
    if (nav.share) {
      try {
        await nav.share({
          title: 'Join me on Loamy',
          text: 'Loamy is Nigeria’s agricultural operating system. Join with my link.',
          url: link,
        })
        return
      } catch { /* the member dismissed the sheet */ }
    }
    void copy()
  }

  async function redeem(b: Benefit) {
    setBusy(b.id)
    await supabase.rpc('loamy_redeem_benefit', { p_benefit_id: b.id })
    setBusy(null)
    await load()
  }

  const headline = benefitsHeadline(summary)
  const programme = summary?.code?.programme
  const earned = (summary?.benefits ?? []).filter((b) => b.status === 'earned')
  const used = (summary?.benefits ?? []).filter((b) => b.status !== 'earned')

  return (
    <>
      <div className="mx-auto max-w-3xl space-y-4">
        <header>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-emerald-950">
            <UserPlus className="h-5 w-5 text-emerald-700" strokeWidth={1.5} aria-hidden />
            Invite & Benefits
          </h1>
          <p className="mt-0.5 text-sm text-emerald-900/60">
            Bring people onto Loamy and earn platform benefits.
          </p>
        </header>

        {justQualified > 0 && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {justQualified === 1
              ? 'One of your referrals has just qualified.'
              : `${justQualified} of your referrals have just qualified.`}
          </p>
        )}

        {/* The link */}
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-emerald-950">Your invite link</h2>
          {summary === null ? (
            <div className="mt-2 h-9 animate-pulse rounded bg-emerald-900/5" aria-hidden />
          ) : (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded border border-line bg-emerald-900/[0.02] px-3 py-2 font-mono text-sm text-emerald-900/85">
                  {link || 'Set a username to get a link'}
                </code>
                <Button size="sm" variant="outline" onClick={copy} disabled={!link}>
                  {copied
                    ? <><Check className="h-3.5 w-3.5" strokeWidth={2} aria-hidden /> Copied</>
                    : <><Copy className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /> Copy</>}
                </Button>
                <Button size="sm" onClick={share} disabled={!link}>
                  <Share2 className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /> Share
                </Button>
              </div>

              {!summary.code.is_username && (
                <p className="mt-2 text-xs text-emerald-900/60">
                  Choose a username in Settings for a cleaner link.
                </p>
              )}

              {/* Said once, plainly, where the link is. */}
              <p className="mt-3 flex items-start gap-1.5 border-t border-line pt-2.5 text-xs text-emerald-900/60">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
                Loamy referrals earn platform benefits, not commission. Growth Partners are
                paid for field work - that is a separate programme.
              </p>
            </>
          )}
        </Card>

        {/* Benefits — where an affiliate product would put a naira total. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="p-4">
            <p className="flex items-center gap-1.5 text-xs text-emerald-900/55">
              <Gift className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /> Platform benefits
            </p>
            <p className="mt-0.5 text-xl font-semibold text-emerald-950">{headline.value}</p>
            <p className="mt-0.5 text-xs text-emerald-900/55">{headline.caption}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-emerald-900/55">People you have invited</p>
            <p className="mt-0.5 font-mono text-xl font-semibold text-emerald-950">
              {summary?.counts?.total ?? 0}
            </p>
            <p className="mt-0.5 text-xs text-emerald-900/55">
              {summary?.counts?.qualified ?? 0} qualified
            </p>
          </Card>
        </div>

        {/* What counts */}
        {programme && (
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-emerald-950">How it works</h2>
            <p className="mt-1 text-sm text-emerald-900/75">
              An invite counts when the person you invited{' '}
              <strong className="font-medium text-emerald-950">
                {qualificationLabel(programme.qualification?.type)}
              </strong>
              . Signing up on its own is not enough.
            </p>
            {programme.benefits?.length > 0 && (
              <ul className="mt-2 space-y-1">
                {programme.benefits.map((b) => (
                  <li key={b.code} className="flex items-center gap-1.5 text-xs text-emerald-900/70">
                    <Sparkles className="h-3 w-3 shrink-0 text-emerald-600" strokeWidth={1.5} aria-hidden />
                    {b.label}
                    <span className="text-emerald-900/40">
                      · {BENEFIT_KIND_LABEL[b.kind] ?? b.kind}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-emerald-900/50">
              A referrer can only be recorded within {programme.attribution_window_hours} hours
              of someone signing up, and it cannot be changed afterwards.
            </p>
          </Card>
        )}

        {/* Your benefits */}
        {(earned.length > 0 || used.length > 0) && (
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-emerald-950">Your benefits</h2>
            <ul className="mt-2 divide-y divide-line border-t border-line">
              {[...earned, ...used].map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm text-emerald-950">{b.label}</p>
                    <p className="text-[11px] text-emerald-900/50">
                      {BENEFIT_KIND_LABEL[b.kind] ?? b.kind} · {b.ref}
                    </p>
                  </div>
                  {b.status === 'earned' ? (
                    <Button size="sm" variant="outline" loading={busy === b.id}
                            onClick={() => redeem(b)}>
                      Use it
                    </Button>
                  ) : (
                    <span className={cn('rounded border px-1.5 py-0.5 text-[11px] font-medium',
                      b.status === 'redeemed' ? TONE.good : TONE.idle)}>
                      {b.status === 'redeemed' ? 'Used'
                        : b.status === 'revoked' ? 'Withdrawn' : 'Expired'}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* People */}
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-emerald-950">People you invited</h2>
          {summary === null ? (
            <div className="mt-2 h-12 animate-pulse rounded bg-emerald-900/5" aria-hidden />
          ) : summary.people.length === 0 ? (
            <p className="mt-2 text-sm text-emerald-900/55">
              Nobody yet. Share your link to get started.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-line border-t border-line">
              {summary.people.map((p) => {
                const meta = REFERRAL_STATE[p.status as ReferralStatus] ?? REFERRAL_STATE.registered
                return (
                  <li key={p.ref} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm text-emerald-950">{p.display}</p>
                      <p className="text-[11px] text-emerald-900/50">
                        Joined {p.joined}
                        {p.progress?.needs ? ` · waiting on ${p.progress.needs}` : ''}
                      </p>
                    </div>
                    <span className={cn('rounded border px-1.5 py-0.5 text-[11px] font-medium',
                      TONE[meta.tone])}>
                      {meta.label}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}
