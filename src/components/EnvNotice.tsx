import { TerminalSquare } from 'lucide-react'
import { Logo } from '@/components/Logo'

/** Shown instead of the app until real Supabase env values are pasted in. */
export function EnvNotice() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-emerald-900 p-6">
      <div className="w-full max-w-lg rounded-card bg-white p-8 shadow-card-hover">
        <Logo tone="light" withTagline />
        <div className="mt-6 flex items-start gap-3 rounded-lg bg-emerald-50 p-4">
          <TerminalSquare className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden />
          <div className="text-sm text-emerald-950">
            <p className="font-semibold">Supabase environment not configured yet</p>
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-emerald-900/70">
              <li>
                Copy <code className="rounded bg-white px-1 font-mono text-xs">.env.example</code>{' '}
                to <code className="rounded bg-white px-1 font-mono text-xs">.env</code>
              </li>
              <li>
                Paste the SAME <code className="rounded bg-white px-1 font-mono text-xs">VITE_SUPABASE_URL</code> and{' '}
                <code className="rounded bg-white px-1 font-mono text-xs">VITE_SUPABASE_ANON_KEY</code>{' '}
                the Founding Member Portal uses
              </li>
              <li>Restart the dev server</li>
            </ol>
            <p className="mt-3 text-xs text-emerald-900/50">
              Only the anon key - never the service_role key - belongs in this app.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
