/**
 * Browser -> Loam. A same-origin POST, nothing more.
 *
 * The endpoint is same-origin BY DEFAULT: in development it is the Vite
 * middleware. `VITE_LOAM_API_BASE_URL` can point it at a deployed backend on
 * another origin, which is the only change this file needs for the cloud
 * migration -- and it is a URL, never a credential.
 *
 * The browser still never learns the inference URL, never holds the system
 * prompt, never sees the hosted provider token and never calls the model
 * directly. Those all live behind the backend.
 *
 * The access token is read from the live Supabase session rather than passed in
 * by a caller, so there is no path by which a component could send someone
 * else's token or forge a user id — the server derives the member from the JWT.
 */
import { supabase } from '@/lib/supabase'
import type { LoamRequest, LoamResponse } from '@/lib/loam/types'

/** The path, always. Only the ORIGIN in front of it is configurable. */
export const LOAM_CHAT_PATH = '/loam/chat'

/**
 * Where the Loam backend lives, as a browser-visible setting.
 *
 * WHY THIS IS PUBLIC AND SAFE
 *   It is a URL, not a credential. `VITE_` means Vite compiles it into the
 *   bundle, which is correct here and would be a disaster for a token --
 *   every secret the backend holds (the hosted provider token, the worker
 *   secret) stays server-side and is never read in this file.
 *
 * WHY THE DEFAULT IS AN EMPTY STRING
 *   Empty means same-origin, which is exactly the current behaviour: in
 *   development the Vite middleware serves `/loam/chat` on the same origin as
 *   the app. So an unset variable changes nothing, and this whole mechanism
 *   is inert until somebody deliberately points it at a deployed backend.
 *
 *   The production value is NOT set here. There is no deployed backend yet,
 *   and inventing a hostname would be worse than leaving it unset -- a build
 *   that looks configured and resolves to nothing is harder to diagnose than
 *   one that is obviously pending.
 */
export function resolveApiBase(raw: string | undefined | null): string {
  const value = (raw ?? '').trim()
  if (!value) return ''

  let url: URL
  try {
    url = new URL(value)
  } catch {
    // Not absolute, so it cannot name a different origin. Treated as unset
    // rather than silently producing `//loam/chat` or a relative mess.
    return ''
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''

  // Origin only: a path, query or fragment on the base would end up spliced
  // in front of `/loam/chat` and produce a URL nobody intended.
  return url.origin
}

export const LOAM_API_BASE = resolveApiBase(
  import.meta.env.VITE_LOAM_API_BASE_URL as string | undefined,
)

/**
 * The full endpoint. Same-origin when no base is configured, which keeps the
 * development flow and every existing test unchanged.
 */
export const LOAM_ENDPOINT = `${LOAM_API_BASE}${LOAM_CHAT_PATH}`

export class LoamUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LoamUnavailable'
  }
}

export async function askLoam(req: LoamRequest): Promise<LoamResponse> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token

  let res: Response
  try {
    res = await fetch(LOAM_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(req),
      /**
       * Longer than the server's own inference ceiling (220s), so the browser
       * is never the component that gives up first. A client timeout that
       * fires before the server's turns a slow answer into a confusing error
       * with a perfectly good response arriving behind it.
       */
      signal: AbortSignal.timeout(260_000),
    })
  } catch (e) {
    throw new LoamUnavailable((e as Error).name === 'TimeoutError'
      ? 'Loam took too long to answer.'
      : 'Loam could not be reached.')
  }

  if (!res.ok) {
    // The server sends a plain message and never a stack trace; surface it, or
    // a neutral fallback if the body is not what we expect.
    const body = await res.json().catch(() => null) as { error?: string } | null
    throw new LoamUnavailable(body?.error ?? 'Loam could not answer that right now.')
  }
  return (await res.json()) as LoamResponse
}
