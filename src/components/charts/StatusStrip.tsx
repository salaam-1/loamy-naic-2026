import { formatDateShort } from '@/lib/utils'

interface StatusStripProps {
  /** Ordered stage labels, e.g. Submitted → Under review → … */
  stages: string[]
  /** Index of the current stage (last reached). */
  currentIndex: number
  /** Optional timestamp per reached stage (from status_history). */
  timestamps?: (string | null)[]
}

/** Horizontal status timeline strip — reached stages in emerald, current in
 * gold, future muted. Real transitions only; no invented dates. */
export function StatusStrip({ stages, currentIndex, timestamps }: StatusStripProps) {
  return (
    <ol className="flex flex-wrap items-start gap-0">
      {stages.map((stage, i) => {
        const reached = i < currentIndex
        const current = i === currentIndex
        return (
          <li key={stage} className="flex items-start">
            {i > 0 && (
              <span
                className={`mt-[5px] h-0.5 w-6 sm:w-10 ${i <= currentIndex ? 'bg-emerald-600' : 'bg-emerald-950/10'}`}
                aria-hidden
              />
            )}
            <div className="flex flex-col items-center px-1">
              <span
                className={
                  current
                    ? 'h-3 w-3 rounded-full border-2 border-gold-400 bg-gold-100'
                    : reached
                      ? 'h-3 w-3 rounded-full bg-emerald-600'
                      : 'h-3 w-3 rounded-full border border-emerald-950/15 bg-white'
                }
                aria-hidden
              />
              <span className={`mt-1 max-w-20 text-center text-[10px] leading-tight ${current ? 'font-semibold text-emerald-950' : 'text-emerald-900/55'}`}>
                {stage}
              </span>
              {timestamps?.[i] && (
                <span className="font-mono text-[9px] text-emerald-900/40">{formatDateShort(timestamps[i])}</span>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
