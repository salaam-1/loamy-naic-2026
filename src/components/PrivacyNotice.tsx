import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { NOTICE_COPY, POLICY_EFFECTIVE_DATE, POLICY_VERSION } from '@/content/legal/privacy-policy'
import { useConsent } from '@/lib/useConsent'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

/**
 * The privacy notice.
 *
 * DESIGN DECISIONS THAT ARE NOT COSMETIC
 *
 *   It is a BANNER, not a modal. The brief asks that it not prevent people
 *   reading the site, and Loamy's public marketplace is browsable without an
 *   account — a dialog with a dimmed overlay would hold the whole storefront
 *   hostage over a choice about search analytics. Nothing behind it is
 *   blocked, and nothing essential is covered: it sits at the bottom, and the
 *   sticky navigation is at the top.
 *
 *   "Essential only" is a REAL BUTTON, weighted the same as "Accept all".
 *   A notice whose decline path is hidden behind "manage preferences" while
 *   the accept path is one bright click is a dark pattern, and it is also the
 *   thing regulators look for first.
 *
 *   It does not shift the page. The banner is fixed rather than in flow, so
 *   it cannot reflow content underneath it as it appears.
 *
 *   Focus moves to the banner when it opens and returns to the page when it
 *   closes, but focus is NOT trapped: this is not a modal, and trapping focus
 *   in something a person is allowed to ignore would make the site unusable
 *   by keyboard until they answered.
 *
 *   Escape chooses nothing. Dismissing without a decision would have to mean
 *   either "accept" (deceptive) or "decline" (a choice they did not make), so
 *   the banner stays until one of the buttons is pressed. There is no close
 *   X for the same reason.
 */
/**
 * WHY THESE CONTROLS CARRY `min-h-touch` EXPLICITLY
 *   `size="sm"` is 32px by design, for dense in-page actions. A consent
 *   decision is not one of those: it is the first thing a member is asked, on
 *   every page, in every language, and often on a phone. So the four controls
 *   and the policy link are raised to the 44px token individually rather than
 *   by changing the `sm` variant, which would move every small button in the
 *   product and is a separate piece of work.
 *
 *   Measured in Wave A.4's bank QA at 335.5x32 (390px) and 74.33x32 (768px).
 */
export function PrivacyNotice() {
  const { mustAsk, save } = useConsent()
  const [expanded, setExpanded] = useState(false)
  const [analytics, setAnalytics] = useState(false)
  // Drives the entrance transition. The design system allows 150ms colour
  // transitions and nothing decorative, so this is a short fade and rise.
  const [shown, setShown] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!mustAsk) {
      setShown(false)
      return
    }
    const t = window.setTimeout(() => setShown(true), 50)
    return () => window.clearTimeout(t)
  }, [mustAsk])

  useEffect(() => {
    if (mustAsk && shown) panelRef.current?.focus()
  }, [mustAsk, shown])

  if (!mustAsk) return null

  return (
    <div
      // `region` with a label: a screen-reader user can jump to it, and it is
      // announced without the interruption an alertdialog would cause.
      role="region"
      aria-label="Privacy preferences"
      className="fixed inset-x-0 bottom-0 z-40 p-3 sm:p-4"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          'mx-auto max-w-3xl rounded border border-line bg-white transition-all duration-150 ease-out focus-visible:outline-none',
          shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
        )}
      >
        <div className="flex gap-3 p-4">
          <ShieldCheck className="mt-0.5 hidden h-5 w-5 shrink-0 text-emerald-800 sm:block" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-emerald-950">{NOTICE_COPY.title}</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-emerald-900/70">{NOTICE_COPY.body}</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-emerald-900/70">{NOTICE_COPY.optional}</p>

            {expanded && (
              <div className="mt-3 space-y-2 border-t border-line pt-3">
                <CategoryRow
                  name="Essential"
                  description="Signing you in, keeping your cart, holding field evidence captured offline until it can be uploaded, and remembering this choice. Always on - the platform does not work without it."
                  checked
                  locked
                />
                <CategoryRow
                  name="Product analytics and recommendations"
                  description="Recording what you search for and which listings you open, so we can improve the product and show you more useful results. Your email, phone number and IP address are never part of this."
                  checked={analytics}
                  onChange={setAnalytics}
                />
                <p className="text-[11px] text-emerald-900/45">
                  Loamy runs no advertising or marketing tracking, so there is nothing of that kind
                  to turn off.
                </p>
              </div>
            )}

            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              {expanded ? (
                <Button size="sm" className="min-h-touch" onClick={() => save(analytics)}>
                  {NOTICE_COPY.save}
                </Button>
              ) : (
                <>
                  <Button size="sm" className="min-h-touch" onClick={() => save(true)}>
                    {NOTICE_COPY.acceptAll}
                  </Button>
                  {/* Same size, same prominence as accepting. */}
                  <Button size="sm" variant="outline" className="min-h-touch" onClick={() => save(false)}>
                    {NOTICE_COPY.essentialOnly}
                  </Button>
                  <Button size="sm" variant="ghost" className="min-h-touch" onClick={() => setExpanded(true)}>
                    {NOTICE_COPY.manage}
                  </Button>
                </>
              )}
              <Link
                to="/privacy"
                className="inline-flex min-h-touch items-center rounded text-[12px] font-medium text-emerald-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 sm:ml-auto"
              >
                {NOTICE_COPY.policyLink}
              </Link>
            </div>

            <p className="mt-2 text-[11px] text-emerald-900/40">
              Version {POLICY_VERSION} · {POLICY_EFFECTIVE_DATE}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * One preference. A real checkbox rather than a styled div, so it is
 * focusable, toggles with Space, and announces its state without any ARIA.
 */
export function CategoryRow({
  name, description, checked, locked, onChange,
}: {
  name: string
  description: string
  checked: boolean
  locked?: boolean
  onChange?: (next: boolean) => void
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-2.5 rounded p-2 transition-colors',
        locked ? 'cursor-default bg-emerald-50/50' : 'hover:bg-emerald-50/60',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={locked}
        onChange={(e) => onChange?.(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 disabled:opacity-60"
      />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-emerald-950">
          {name}
          {locked && <span className="ml-1.5 font-normal text-emerald-900/45">Always on</span>}
        </span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-emerald-900/60">{description}</span>
      </span>
    </label>
  )
}
