/**
 * Public identity helpers — usernames, ratings, review presentation.
 *
 * The rules here MIRROR the database (migration 20260920100001/2); they never
 * replace it. Client-side validation exists so a member gets an answer while
 * typing, not because the browser is trusted.
 */

export const USERNAME_MIN = 3
export const USERNAME_MAX = 30

/** Lowercase, trim, and strip a leading @ so pasting "@musa" works. */
export function normaliseUsername(input: string): string {
  return input.trim().replace(/^@+/, '').toLowerCase()
}

export type UsernameCheck = { ok: true } | { ok: false; message: string }

/**
 * The same shape as the server's refusal, so the UI renders one code path
 * whether the answer came from here or from loamy_username_available.
 */
export function validateUsername(input: string): UsernameCheck {
  const name = normaliseUsername(input)

  if (name.length === 0) return { ok: false, message: 'Choose a username.' }
  if (name.length < USERNAME_MIN)
    return { ok: false, message: `At least ${USERNAME_MIN} characters.` }
  if (name.length > USERNAME_MAX)
    return { ok: false, message: `At most ${USERNAME_MAX} characters.` }
  if (!/^[a-z0-9_]+$/.test(name))
    return { ok: false, message: 'Lowercase letters, numbers and underscore only.' }
  if (!/[a-z]/.test(name))
    return { ok: false, message: 'A username needs at least one letter.' }

  return { ok: true }
}

/** A handle as it is displayed and linked. */
export function handle(username: string | null | undefined): string {
  return username ? `@${username}` : ''
}

export function profilePath(username: string): string {
  return `/u/${normaliseUsername(username)}`
}

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------

export interface RatingSummary {
  count: number
  has_enough: boolean
  minimum_for_average: number
  average: number | null
  distribution: Record<string, number>
}

/**
 * What to SHOW for a rating.
 *
 * Below the server's threshold there is deliberately no number. Three
 * five-star reviews from a seller's own network is not a 5.0, and rendering
 * one as though it were is the most common way these systems mislead a buyer.
 * The server already withholds the average; this makes sure the UI does not
 * invent one from the distribution.
 */
export function ratingDisplay(summary: RatingSummary | null | undefined): {
  value: string
  caption: string
  showStars: boolean
} {
  const n = summary?.count ?? 0

  if (n === 0) {
    return { value: '-', caption: 'No reviews yet', showStars: false }
  }
  if (!summary?.has_enough || summary.average == null) {
    const need = (summary?.minimum_for_average ?? 3) - n
    return {
      value: '-',
      caption: `${n} review${n === 1 ? '' : 's'} · ${need} more before a rating is shown`,
      showStars: false,
    }
  }
  return {
    value: summary.average.toFixed(1),
    caption: `${n} review${n === 1 ? '' : 's'}`,
    showStars: true,
  }
}

/** Percentage split for the 5→1 bars, from the raw distribution. */
export function ratingBars(summary: RatingSummary | null | undefined): {
  star: number
  count: number
  percent: number
}[] {
  const dist = summary?.distribution ?? {}
  const total = Object.values(dist).reduce((n, v) => n + Number(v || 0), 0)
  return [5, 4, 3, 2, 1].map((star) => {
    const count = Number(dist[String(star)] ?? 0)
    return { star, count, percent: total > 0 ? Math.round((count / total) * 100) : 0 }
  })
}

/**
 * Why a member cannot review, in words. The server returns a reason code; the
 * copy lives here so it stays consistent wherever the button appears.
 */
export function reviewRefusal(reason: string | undefined): string {
  switch (reason) {
    case 'already_reviewed': return 'You have already reviewed this deal.'
    case 'not_concluded': return 'You can review once the goods have been received.'
    case 'in_dispute': return 'This deal is in dispute. Reviews reopen once it is resolved.'
    case 'no_such_transaction': return 'This deal is not available to review.'
    case 'not_signed_in': return 'Sign in to leave a review.'
    default: return 'You cannot review this deal.'
  }
}

/** Member-since, as a year and month rather than a false-precision date. */
export function memberSince(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-NG', { month: 'long', year: 'numeric' })
}
