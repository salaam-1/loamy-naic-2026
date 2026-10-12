import { cn } from '@/lib/utils'

/**
 * The one decorative motif on the landing page: an emerald (or white, on dark
 * bands) section heading with a short 2px gold rule beneath it. Used
 * identically under every section heading and nowhere else.
 */
export function SectionHeading({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <div>
      <h2 className={cn('text-xl font-bold -tracking-[0.01em]', dark ? 'text-white' : 'text-emerald-800')}>
        {children}
      </h2>
      <div className="mt-2 h-0.5 w-10 bg-gold-400" aria-hidden />
    </div>
  )
}
