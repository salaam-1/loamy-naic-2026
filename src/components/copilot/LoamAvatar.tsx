import { useState, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'

/**
 * Loam — the Copilot's face.
 *
 * WHAT HAPPENED TO THE SPARKLE
 *   The Copilot was represented by a generic ✨ sparkle: the single most
 *   overused signifier for "AI feature" on the web, and a signifier that says
 *   nothing about farming, Loamy, or what the thing actually does. Loam is
 *   meant to read as a helpful character waiting for you, not as a feature
 *   button.
 *
 * THE ASSET SITUATION, STATED PLAINLY
 *   The Loam character render is NOT in this repository. `public/images/`
 *   contains three Nigerian farming photographs, the Loamy logo mark, and
 *   `leaf.svg` — and nothing else. No reference artwork reached this build
 *   either.
 *
 *   The instruction was to reuse the closest existing APPROVED Loamy asset
 *   rather than invent a different mascot, so that is what this does: the
 *   fallback is the Loamy leaf mark on the brand's own emerald, which is
 *   already an approved agricultural brand asset. It is not a character, and
 *   it does not pretend to be one.
 *
 *   When the real renders arrive, drop them in as:
 *
 *     public/images/loam/loam-default.png
 *     public/images/loam/loam-thinking.png
 *     public/images/loam/loam-happy.png
 *     public/images/loam/loam-concerned.png
 *
 *   …and this component picks them up with no other change. Square, ≥192px,
 *   transparent background. The `onError` fallback means a missing file
 *   degrades to the leaf rather than to a broken-image icon.
 *
 * EXPRESSIONS
 *   Only the four states the Copilot can actually be in are modelled, because
 *   an expression the product cannot reach is decoration. There is no frame
 *   animation: swapping static images quickly to fake motion is exactly what
 *   the brief rules out.
 */
export type LoamExpression = 'default' | 'thinking' | 'happy' | 'concerned'

const ASSET: Record<LoamExpression, string> = {
  default: '/images/loam/loam-default.png',
  thinking: '/images/loam/loam-thinking.png',
  happy: '/images/loam/loam-happy.png',
  concerned: '/images/loam/loam-concerned.png',
}

/**
 * The fallback: Loamy's own leaf mark.
 *
 * Inline rather than an <img> so it inherits currentColor for the leaf and
 * stays crisp at 24px on a phone. The shapes are lifted from
 * `public/leaf.svg`, which is the approved mark — not a new drawing.
 */
function LeafMark({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 32 32" className={className} style={style} aria-hidden focusable="false">
      <path
        d="M22.5 8.5c-6.5.5-11 3.5-12.5 8-.9 2.7-.4 5.5.8 7 .3-2.3 1.5-5.8 4.2-8.3-1.6 3-2.7 6.5-2.5 9.3 1.7.6 4.3.4 6.3-1 3.6-2.5 4.6-9 3.7-15z"
        fill="currentColor"
      />
    </svg>
  )
}

export function LoamAvatar({
  expression = 'default',
  size = 40,
  className,
}: {
  expression?: LoamExpression
  /** Rendered size in px. 40–48 for the launcher, 32 in the panel header. */
  size?: number
  className?: string
}) {
  const [assetFailed, setAssetFailed] = useState(false)

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full',
        // A warm shell rather than a green disc: Loam should read as a small
        // object sitting on the surface, not as another block of brand colour.
        'bg-gradient-to-b from-bone to-sand ring-1 ring-inset ring-emerald-900/15',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {assetFailed ? (
        <LeafMark
          className="text-emerald-800"
          // The leaf reads best at ~60% of the shell.
          style={{ width: size * 0.6, height: size * 0.6 }}
        />
      ) : (
        <img
          src={ASSET[expression]}
          alt=""
          className="h-full w-full object-contain"
          onError={() => setAssetFailed(true)}
        />
      )}

      {/* Thinking is the one state that earns motion, because it means "wait".
          A single pulsing dot, not a spinner and not a glow. Suppressed under
          prefers-reduced-motion by the global rule in index.css. */}
      {expression === 'thinking' && (
        <span
          className="absolute bottom-0.5 right-0.5 h-1.5 w-1.5 animate-pulse rounded-full bg-gold-400"
          aria-hidden
        />
      )}
    </span>
  )
}
