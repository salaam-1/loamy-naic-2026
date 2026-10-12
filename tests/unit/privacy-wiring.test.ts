import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONSENT_STORAGE_KEY } from '../../src/lib/consent'
import { en } from '../../src/lib/i18n/packs/en'

/**
 * Integration facts, asserted against the source.
 *
 * These are the claims that would otherwise need the whole application booted
 * with providers and a network to prove: that the route is public, that the
 * footer links to it, that telemetry is gated. Reading the source is an
 * honest way to check them — it proves the wiring exists, and it says so
 * rather than pretending to have rendered the app.
 */

const root = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const src = (p: string) => readFileSync(join(root, p), 'utf8')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(p)) out.push(p)
  }
  return out
}

describe('the policy route is public', () => {
  const app = src('src/App.tsx')

  it('is registered', () => {
    expect(app).toMatch(/path="\/privacy"/)
  })

  it('is NOT behind authentication', () => {
    // Someone deciding whether to sign up has to be able to read it first.
    const line = app.split('\n').find((l) => l.includes('path="/privacy"')) ?? ''
    expect(line).not.toContain('RequireAuth')
    expect(line).not.toContain('RequireAdmin')
    expect(line).not.toContain('RequireBank')
    expect(line).not.toContain('PublicOnly') // signed-in members need it too
  })

  it('mounts the notice outside the route table', () => {
    // Inside <Routes> it would remount and re-animate on every navigation.
    const afterRoutes = app.slice(app.indexOf('</Routes>'))
    expect(afterRoutes).toContain('<PrivacyNotice />')
  })
})

describe('the policy is reachable from everywhere it must be', () => {
  it('from the public footer', () => {
    const shell = src('src/pages/public/PublicShell.tsx')
    expect(shell).toContain("to: '/privacy'")
  })

  it('from the public footer, with a way to reopen preferences', () => {
    const shell = src('src/pages/public/PublicShell.tsx')
    expect(shell).toMatch(/Privacy preferences/)
    expect(shell).toContain('reopenPrivacy')
  })

  it('from every authentication screen', () => {
    expect(src('src/pages/auth/AuthLayout.tsx')).toContain('to="/privacy"')
  })

  it('from signup, next to the button that creates the account', () => {
    expect(src('src/pages/auth/Signup.tsx')).toContain('to="/privacy"')
  })

  it('from inside the app, for every role', () => {
    expect(src('src/pages/shared/sections.ts')).toMatch(/privacy:\s*\{\s*cmp:\s*PrivacySettings/)
    // In COMMON_TAIL, so no role can be missing it.
    const roles = src('src/lib/roles.ts')
    const tail = roles.slice(roles.indexOf('COMMON_TAIL'), roles.indexOf('myBookingsItem'))
    expect(tail).toContain("section: 'privacy'")
  })
})

describe('signup does not bundle optional consent with joining', () => {
  const signup = src('src/pages/auth/Signup.tsx')

  it('has no consent checkbox tied to account creation', () => {
    // Making people "agree" to analytics in order to register is how consent
    // stops being consent.
    expect(signup).not.toMatch(/type="checkbox"[^>]*analytics/i)
  })

  it('says optional analytics stay off unless chosen', () => {
    // The sentence moved into the localization pack in Phase 7, so the page
    // renders a key. Asserting the key is used AND that the key still carries
    // the promise is stronger than the old string match: it now also catches
    // the English being softened in the pack, which the page-only check could
    // not see.
    expect(signup).toContain("t('auth.analyticsStayOff')")
    expect(en['auth.analyticsStayOff']).toContain('stay off unless you choose')
  })

  it('does not link to a Terms page that does not exist', () => {
    // There is no terms content in this codebase. A link to an empty page is
    // worse than no link.
    expect(signup).not.toContain('to="/terms"')
    expect(src('src/pages/public/PublicShell.tsx')).not.toContain("to: '/terms'")
    expect(src('src/App.tsx')).not.toContain('path="/terms"')
  })
})

describe('optional technology respects the preference', () => {
  it('telemetry checks consent before recording', () => {
    const hook = src('src/lib/useDiscoveryEvents.ts')
    expect(hook).toContain("consentAllows('analytics')")
    // Inside record(), so it is checked per call rather than once at mount.
    const recordBody = hook.slice(hook.indexOf('const record = useCallback'))
    expect(recordBody).toContain("if (!consentAllows('analytics')) return")
  })

  it('is the only optional technology there is', () => {
    // If a tracker is ever added, it has to be added to the consent model
    // too. This fails loudly if an obvious one appears.
    const files = walk(join(root, 'src'))
    const offenders: string[] = []
    for (const f of files) {
      const code = readFileSync(f, 'utf8')
      // Matched on the thing that would actually load a tracker -- a host or
      // a global call -- not on a bare product name, which collides with
      // ordinary English ("size_plausible" is a verification checklist key).
      if (/googletagmanager\.com|google-analytics\.com|\bgtag\(|\bfbq\(|cdn\.mxpnl\.com|cdn\.segment\.com|static\.hotjar\.com|posthog\.com|amplitude\.com|plausible\.io/i.test(code)) {
        offenders.push(f.slice(root.length))
      }
    }
    expect(offenders, 'a third-party tracker was added without a consent category').toEqual([])
  })

  it('that tracker pattern is live, not inert', () => {
    // This guard silently could not fire for the whole of its life: the
    // `gtag(` and `fbq(` branches were written with literal backspace
    // characters where word boundaries were intended, so a Google Analytics
    // or Facebook Pixel call would have walked straight past it. The pattern
    // is repeated here and exercised against synthetic samples, so a future
    // escaping slip fails THIS test rather than going unnoticed.
    //
    // Nothing below is added to the application; these are strings.
    const TRACKER =
      /googletagmanager\.com|google-analytics\.com|\bgtag\(|\bfbq\(|cdn\.mxpnl\.com|cdn\.segment\.com|static\.hotjar\.com|posthog\.com|amplitude\.com|plausible\.io/i

    const mustCatch = [
      "gtag('event', 'page_view')",
      'window.gtag("config", "G-XXXX")',
      "fbq('track', 'PageView')",
      'src="https://www.googletagmanager.com/gtm.js"',
      'https://cdn.segment.com/analytics.js',
      'https://static.hotjar.com/c/hotjar.js',
    ]
    for (const sample of mustCatch) {
      expect(TRACKER.test(sample), `did not catch: ${sample}`).toBe(true)
    }

    const mustNotCatch = [
      'size_plausible',              // a verification checklist key
      'const plausibleReason = ""',  // ordinary English
      'investigate(',                // contains "gat" but is not gtag(
      'const fbqueue = []',          // fbq as a prefix, not a call
    ]
    for (const sample of mustNotCatch) {
      expect(TRACKER.test(sample), `false positive on: ${sample}`).toBe(false)
    }

    // And the pattern asserted here must be the one the guard above uses.
    const self = readFileSync(join(root, 'tests/unit/privacy-wiring.test.ts'), 'utf8')
    const occurrences = self.split('googletagmanager').length - 1
    expect(occurrences, 'the guard and this check must share one pattern').toBeGreaterThanOrEqual(2)
  })

  it('introduced no tracking pixels or fingerprinting', () => {
    const files = walk(join(root, 'src'))
    const offenders: string[] = []
    for (const f of files) {
      const code = readFileSync(f, 'utf8')
      if (/canvas\.toDataURL\(|navigator\.plugins|AudioContext\(\)[^)]*fingerprint/i.test(code)) {
        offenders.push(f.slice(root.length))
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('the consent implementation stores nothing sensitive', () => {
  it('writes one key with a predictable name', () => {
    expect(CONSENT_STORAGE_KEY).toBe('loamy.privacy.consent')
  })

  it('never reads a profile, session or user id into the record', () => {
    // Comments stripped first: the word "session" in a sentence explaining
    // the fallback is not a use of a session.
    const consent = src('src/lib/consent.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    for (const forbidden of ['auth.uid', 'supabase', 'getSession', 'user_id', 'userId', 'profile']) {
      expect(consent, `consent.ts must not touch ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('adds no BVN or NIN anywhere', () => {
    // The whole privacy feature, checked as one unit.
    for (const f of [
      'src/lib/consent.ts', 'src/lib/useConsent.ts',
      'src/components/PrivacyNotice.tsx', 'src/components/PrivacyPreferences.tsx',
      'src/pages/public/Privacy.tsx', 'src/pages/shared/PrivacySettings.tsx',
    ]) {
      const code = src(f)
      expect(code, `${f} must not collect a BVN`).not.toMatch(/\bbvn\s*[:=]/i)
      expect(code, `${f} must not collect a NIN`).not.toMatch(/\bnin\s*[:=]/i)
    }
  })

  it('sends no consent record to the server', () => {
    // Recording a choice must not become a reason to create a row about
    // someone who has not signed up.
    expect(src('src/lib/consent.ts')).not.toContain('.rpc(')
    expect(src('src/lib/consent.ts')).not.toContain('.from(')
  })
})
