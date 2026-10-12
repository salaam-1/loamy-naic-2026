import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The hero photographs are CC BY-SA 4.0, and that licence does not become
 * optional because the footer got tidier.
 *
 * Phase 7 removed the paragraph of creator names from the visible footer and
 * replaced it with a link to public/images/IMAGE-CREDITS.md. That is allowed:
 * clause 3(a)(2) of CC BY-SA 4.0 lets the attribution conditions be satisfied
 * "in any reasonable manner based on the medium, means, and context", and
 * names linking to a resource carrying the information as an example.
 *
 * What is NOT allowed is the link going too. A later tidy-up that removes it,
 * or a move of the credits file out of `public/`, silently un-licenses five
 * photographs on the landing page. Nothing about the page would look wrong.
 *
 * So the condition is written down as a test rather than as a comment.
 */

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const CREDITS_PATH = 'public/images/IMAGE-CREDITS.md'
const CREDITS_URL = '/images/IMAGE-CREDITS.md'

/** Creators who must be named somewhere for the licence to be satisfied. */
const CREATORS = ['Photobyamin', 'SMMIMAGES', 'OnyekeEjike', 'Gole Andrew']

/**
 * Source with every comment removed, so an assertion about what the page
 * RENDERS cannot be satisfied by a comment that merely talks about it.
 */
function stripComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')  // JSX {/* ... */}
    .replace(/\/\*[\s\S]*?\*\//g, '')        // block
    .replace(/^\s*\/\/.*$/gm, '')               // line
}

describe('CC BY-SA attribution survives footer changes', () => {
  it('the credits file is served, not just committed', () => {
    // In public/, so Vite copies it verbatim into dist. If it moves into src/
    // it stops being fetchable and the footer link 404s.
    expect(() => read(CREDITS_PATH), `${CREDITS_PATH} must exist`).not.toThrow()
  })

  it('names every creator, with a source and the licence', () => {
    const credits = read(CREDITS_PATH)
    for (const name of CREATORS) {
      expect(credits, `${name} is no longer credited`).toContain(name)
    }
    expect(credits).toContain('commons.wikimedia.org')
    expect(credits).toContain('creativecommons.org/licenses/by-sa/4.0')
  })

  it('states the modifications, which CC BY-SA also requires', () => {
    // The files were cropped and re-encoded; that has to be disclosed.
    const credits = read(CREDITS_PATH).toLowerCase()
    expect(credits).toMatch(/crop|re-encoded|modif/)
  })

  it('the public footer still points at it', () => {
    // The whole basis for removing the paragraph. No link, no attribution.
    //
    // Checked against the JSX with comments stripped. The first version of
    // this assertion searched the raw file, and passed because the comment
    // ABOVE the link explains where the credits live and happens to contain
    // the same path -- so deleting the actual link left the test green.
    const jsx = stripComments(read('src/pages/public/PublicShell.tsx'))
    expect(
      jsx,
      'The footer no longer links to the image credits. CC BY-SA 4.0 is then '
        + 'unsatisfied: either restore the link or remove the CC-licensed heroes.',
    ).toContain(CREDITS_URL)
  })

  it('the condition is tied to CC images actually being in use', () => {
    // If every hero were replaced with owned photography the link could go.
    // This asserts the premise is still true, so the test is about the real
    // situation rather than about itself.
    const heroes = readdirSync(join(ROOT, 'public/images')).filter((f) => /^hero-.*\.jpg$/.test(f))
    expect(heroes.length, 'no hero images found; re-check this test').toBeGreaterThan(0)

    const credits = read(CREDITS_PATH)
    for (const file of heroes) {
      expect(credits, `${file} is shipped but not credited`).toContain(file)
    }
  })

  it('the paragraph of names is gone from the footer', () => {
    // The actual Phase 7 ask. Asserted so it cannot quietly come back.
    const shell = read('src/pages/public/PublicShell.tsx')
    const jsx = stripComments(shell)
    for (const name of CREATORS) {
      expect(jsx, `${name} is still rendered in the footer`).not.toContain(name)
    }
  })
})
