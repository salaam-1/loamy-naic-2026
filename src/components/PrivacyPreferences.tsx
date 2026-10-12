import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { POLICY_EFFECTIVE_DATE, POLICY_VERSION } from '@/content/legal/privacy-policy'
import { useConsent } from '@/lib/useConsent'
import { CategoryRow } from '@/components/PrivacyNotice'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

/**
 * The preference controls, shared by /privacy and Settings → Privacy so the
 * two cannot describe the categories differently.
 *
 * It reports what is currently in force, including WHEN it was chosen and
 * against which version of the policy. Someone who wants to know what they
 * agreed to should be able to see it rather than be reassured that it was
 * saved.
 */
export function PrivacyPreferences() {
  const { record, analytics, save, mustAsk } = useConsent()
  const [draft, setDraft] = useState(analytics)
  const [saved, setSaved] = useState(false)
  /** What this panel last wrote, so it can tell its own save from someone else's. */
  const lastSaved = useRef<boolean | null>(null)

  // Follow the store: a change made in the notice, or in another tab, should
  // be reflected here rather than leaving a stale checkbox behind.
  //
  // The confirmation is cleared only for a change this panel did NOT make.
  // Clearing it unconditionally meant saving updated the store, which ran this
  // effect, which wiped "Saved" in the same tick -- so the confirmation never
  // appeared at all.
  useEffect(() => {
    setDraft(analytics)
    if (lastSaved.current !== analytics) setSaved(false)
  }, [analytics, record])

  const dirty = draft !== analytics

  return (
    <Card className="p-4 sm:p-5">
      <div className="space-y-2">
        <CategoryRow
          name="Essential"
          description="Signing you in, keeping your cart, holding field evidence captured offline until it can be uploaded, and remembering this choice. Always on - the platform does not work without it."
          checked
          locked
        />
        <CategoryRow
          name="Product analytics and recommendations"
          description="Recording what you search for and which listings you open, so we can improve the product and show you more useful results - such as noting supply in a state you do not usually search. Your email, phone number and IP address are never part of this."
          checked={draft}
          onChange={(next) => { setDraft(next); setSaved(false) }}
        />
        <p className="px-2 text-[11px] leading-relaxed text-emerald-900/45">
          Loamy runs no advertising or marketing tracking, and builds no advertising profiles, so
          there is no such category to turn off.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <Button
          size="sm"
          disabled={!dirty}
          onClick={() => { lastSaved.current = draft; save(draft); setSaved(true) }}
        >
          Save preferences
        </Button>
        {saved && !dirty && (
          <span className="flex items-center gap-1 text-[12px] font-medium text-emerald-700" role="status">
            <Check className="h-3.5 w-3.5" aria-hidden /> Saved
          </span>
        )}
        <p className="text-[11px] text-emerald-900/45">
          {mustAsk
            ? `You have not set a preference yet. Only essential storage is in use. Policy version ${POLICY_VERSION}, ${POLICY_EFFECTIVE_DATE}.`
            : `Recorded ${formatWhen(record?.recordedAt)} against policy version ${record?.policyVersion}.`}
        </p>
      </div>
    </Card>
  )
}

function formatWhen(iso: string | undefined): string {
  if (!iso) return 'recently'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'recently'
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })
}
