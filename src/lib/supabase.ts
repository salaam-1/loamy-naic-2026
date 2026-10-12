import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** True once real project values are pasted into .env (see .env.example). */
export const isSupabaseConfigured = Boolean(
  url && anonKey && !url.includes('YOUR_') && !anonKey.includes('YOUR_'),
)

// SECURITY-REVIEW: this client talks to the SAME Supabase project as the
// Founding Member Portal, using the browser-safe anon key ONLY. The
// service_role key must never appear in this codebase or its env files —
// every query issued from this app relies on RLS being enforced.
// The fallback values below only exist so `npm run dev` renders a friendly
// "configure your env" screen instead of crashing before setup.
export const supabase = createClient(
  url && !url.includes('YOUR_') ? url : 'http://localhost:54321',
  anonKey && !anonKey.includes('YOUR_') ? anonKey : 'public-anon-key-placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
)
