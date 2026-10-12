import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LOAM_API_BASE, LOAM_CHAT_PATH, LOAM_ENDPOINT, resolveApiBase } from '@/lib/loam/transport'

/**
 * Where the browser sends a chat turn.
 *
 * WHY THIS IS CONFIGURABLE AT ALL
 *   The backend used to be a Vite plugin with `apply: 'serve'`, so it existed
 *   in no deployed build: in production `/loam/chat` hit the SPA rewrite and
 *   returned HTML. Pointing the browser at a deployed backend is the last
 *   frontend change the migration needs.
 *
 * WHY THE DEFAULT MUST STAY EMPTY
 *   Empty means same-origin, which is the current behaviour. An unset
 *   variable has to change nothing, or every existing test and the whole
 *   development flow would depend on a URL that does not exist yet.
 */

describe('the default is same-origin, so nothing changes until it is set', () => {
  it('resolves an unset variable to an empty base', () => {
    for (const raw of [undefined, null, '', '   ']) {
      expect(resolveApiBase(raw), JSON.stringify(raw)).toBe('')
    }
  })

  it('leaves the endpoint as the bare path when unset', () => {
    // No VITE_LOAM_API_BASE_URL is set in the test environment, so this is
    // the shipped default and must be the relative path.
    expect(LOAM_API_BASE).toBe('')
    expect(LOAM_ENDPOINT).toBe('/loam/chat')
    expect(LOAM_CHAT_PATH).toBe('/loam/chat')
  })
})

describe('a configured base is reduced to an origin', () => {
  it('accepts https and http', () => {
    expect(resolveApiBase('https://api.example.test')).toBe('https://api.example.test')
    expect(resolveApiBase('http://api.example.test')).toBe('http://api.example.test')
  })

  it('strips a trailing slash, a path, a query and a fragment', () => {
    /**
     * Anything after the origin would be spliced in FRONT of `/loam/chat`
     * and produce a URL nobody intended -- `https://x/api//loam/chat`.
     */
    for (const raw of [
      'https://api.example.test/',
      'https://api.example.test/api',
      'https://api.example.test/api/',
      'https://api.example.test?k=v',
      'https://api.example.test#frag',
    ]) {
      expect(resolveApiBase(raw), raw).toBe('https://api.example.test')
    }
  })

  it('keeps an explicit port, which a staging host often needs', () => {
    expect(resolveApiBase('https://api.example.test:8443')).toBe('https://api.example.test:8443')
  })

  it('treats a non-absolute or non-http value as unset', () => {
    /**
     * Falling back to same-origin is the safe reading: the alternative is
     * emitting `//loam/chat` or `ftp://.../loam/chat`, which fails in a way
     * nobody can diagnose from the network tab.
     */
    for (const raw of ['/api', 'api.example.test', 'ftp://x.test', 'javascript:alert(1)', '::::']) {
      expect(resolveApiBase(raw), raw).toBe('')
    }
  })

  it('composes a full endpoint when a base is present', () => {
    expect(`${resolveApiBase('https://api.example.test/')}${LOAM_CHAT_PATH}`)
      .toBe('https://api.example.test/loam/chat')
  })
})

describe('the browser is given a URL and nothing else', () => {
  const src = readFileSync('src/lib/loam/transport.ts', 'utf8')

  it('reads exactly one VITE_ variable, and it is the base URL', () => {
    const found = [...new Set([...src.matchAll(/VITE_[A-Z_]+/g)].map((m) => m[0]))]
    expect(found).toEqual(['VITE_LOAM_API_BASE_URL'])
  })

  it('carries no credential, model or inference address', () => {
    /**
     * The whole point of keeping the backend between the browser and the
     * model. A base URL is public; a token, a model id and an inference host
     * are not.
     */
    /**
     * `Bearer ${token}` IS present and must be: that is the member's own
     * Supabase JWT, read from the live session. What must not appear is a
     * PROVIDER credential -- the hosted inference token, an API key, the
     * speech worker secret.
     */
    expect(src).not.toMatch(/VITE_[A-Z_]*(TOKEN|SECRET|API_KEY)/)
    expect(src).not.toMatch(/LOAM_HOSTED_TOKEN|LOAM_STT_WORKER_SECRET|LOAM_INFERENCE_TOKEN/)
    expect(src).not.toContain('11434')
    expect(src).not.toMatch(/LOAM_HOSTED|LOAM_PROVIDER|LOAM_MODEL/)
  })

  it('still sends the member JWT from the live session, not from a caller', () => {
    // Unchanged: there is no path by which a component could send someone
    // else's token, because the transport reads the session itself.
    expect(src).toContain('supabase.auth.getSession()')
    expect(src).toContain('Authorization')
  })
})
