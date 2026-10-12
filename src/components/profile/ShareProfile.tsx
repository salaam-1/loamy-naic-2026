import { useEffect, useState } from 'react'
import { Check, Copy, Share2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Share a profile.
 *
 * Uses the device share sheet where it exists — on a phone that is the
 * native, expected behaviour and it reaches WhatsApp, which is how Nigerian
 * agricultural business actually gets introduced. Falls back to copying the
 * link, and falls back again to a selectable input if the clipboard is
 * blocked (it is, in insecure contexts and some in-app browsers).
 *
 * The URL is built from the CANONICAL handle rather than from
 * window.location, so sharing from an odd path still produces /u/:username.
 */
export function ShareProfile({
  username,
  displayName,
  className,
}: {
  username: string
  displayName: string
  className?: string
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [canShare, setCanShare] = useState(false)

  useEffect(() => {
    // Checked in an effect, not during render: navigator.share does not exist
    // during SSR and is absent on most desktops.
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function')
  }, [])

  const url = typeof window !== 'undefined'
    ? `${window.location.origin}/u/${username}`
    : `/u/${username}`

  async function share() {
    if (canShare) {
      try {
        await navigator.share({
          title: displayName,
          text: `${displayName} on Loamy`,
          url,
        })
        return
      } catch {
        // A dismissed share sheet is not a failure; fall through to copying
        // only if the sheet was unavailable rather than cancelled.
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setState('copied')
    } catch {
      setState('failed')
    }
  }

  useEffect(() => {
    if (state !== 'copied') return
    const t = window.setTimeout(() => setState('idle'), 2200)
    return () => window.clearTimeout(t)
  }, [state])

  return (
    <div className={cn('flex flex-col items-start gap-2', className)}>
      <button
        type="button"
        onClick={share}
        className="inline-flex h-10 items-center gap-2 rounded-control border border-clay bg-white/80 px-4 text-[13px] font-semibold text-emerald-900 backdrop-blur-[2px] transition-colors hover:bg-white"
      >
        {state === 'copied' ? (
          <>
            <Check className="h-4 w-4 text-emerald-700" aria-hidden /> Link copied
          </>
        ) : (
          <>
            {canShare ? <Share2 className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
            {canShare ? 'Share profile' : 'Copy link'}
          </>
        )}
      </button>

      {/* Clipboard blocked. Rather than a dead button, show the link so it can
          be selected by hand — which is what someone will do anyway. */}
      {state === 'failed' && (
        <label className="w-full">
          <span className="sr-only">Profile link</span>
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded-control border border-clay bg-white px-3 py-2 font-mono text-[12px] text-emerald-900"
          />
        </label>
      )}
      <span aria-live="polite" className="sr-only">
        {state === 'copied' ? 'Profile link copied to clipboard' : ''}
      </span>
    </div>
  )
}
