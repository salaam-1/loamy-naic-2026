import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The class of bug that shipped the language selector at 41px.
 *
 * Nothing was misspelt and nothing was lazy. The class was `min-h-11`, which
 * is 2.75rem, which is the documented 44px -- at a 16px root font. This app
 * sets 15px on purpose, so every rem-based size is multiplied by 0.9375 and
 * `min-h-11` renders at 41.25px. A reviewer reading the diff sees the right
 * number; only the rendered box disagrees.
 *
 * Measuring is the browser's job (scripts/verify-touch-targets.mjs renders the
 * real pages and reads getBoundingClientRect). What a unit test can do is hold
 * the three things that made the bug POSSIBLE:
 *
 *   1. the root font size the token arithmetic assumes;
 *   2. that the token is absolute px and so cannot drift with it;
 *   3. that the shared primitives use the token rather than a rem class.
 *
 * If somebody moves the root font to 16px, (1) fails and points them here
 * instead of leaving 40-odd controls quietly 6% short.
 */

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/** The root font size this app actually sets. */
const ROOT_FONT_PX = 15

describe('the arithmetic behind the touch token', () => {
  it('src/index.css still sets the root font the token assumes', () => {
    const css = read('src/index.css')
    const m = css.match(/html\s*\{[^}]*?font-size:\s*(\d+(?:\.\d+)?)px/s)
      ?? css.match(/:root\s*\{[^}]*?font-size:\s*(\d+(?:\.\d+)?)px/s)
      ?? css.match(/font-size:\s*(\d+(?:\.\d+)?)px/)
    expect(m, 'no root font-size found in src/index.css').toBeTruthy()
    expect(
      Number(m![1]),
      'The root font size changed. Every rem-based size moved with it, so the '
        + 'rem-vs-px assumptions in tailwind.config.ts and this test must be '
        + 're-derived before the new value is accepted.',
    ).toBe(ROOT_FONT_PX)
  })

  it('demonstrates why min-h-11 is not 44px here', () => {
    // 11 on Tailwind's spacing scale is 2.75rem.
    const rendered = 2.75 * ROOT_FONT_PX
    expect(rendered).toBeCloseTo(41.25, 2)
    expect(rendered, 'min-h-11 must NOT be treated as a 44px target').toBeLessThan(44)
  })

  it('exposes the whole rem range that looks right and is not', () => {
    // Anything from min-h-11 up is "44px or more" on the scale and short here.
    for (const step of [10, 11]) {
      expect(step * 0.25 * ROOT_FONT_PX).toBeLessThan(44)
    }
    // 12 (3rem) is the first rem step that clears it, at 45px.
    expect(12 * 0.25 * ROOT_FONT_PX).toBeGreaterThanOrEqual(44)
  })

  it('the touch token is absolute pixels, so it cannot drift', () => {
    const cfg = read('tailwind.config.ts')
    const m = cfg.match(/spacing:\s*\{[^}]*?touch:\s*'(\d+)px'/s)
    expect(m, 'spacing.touch is missing from tailwind.config.ts').toBeTruthy()
    expect(Number(m![1])).toBe(44)
    expect(m![0], 'the token must be px; rem would reintroduce the bug').not.toMatch(/rem/)
  })

  it('provides the touch-target utilities an inline control needs', () => {
    const cfg = read('tailwind.config.ts')
    // min-height does nothing on an inline box, so a text link needs a
    // utility that sets the display mode too.
    expect(cfg).toContain("'.touch-target'")
    expect(cfg).toContain("'.touch-target-sq'")
    expect(cfg).toMatch(/minHeight:\s*'44px'/)
    expect(cfg).toMatch(/minWidth:\s*'44px'/)
  })
})

describe('the shared primitives carry the floor, not their callers', () => {
  // These are the controls almost every screen composes. If the floor lives
  // here, a page cannot ship a short control by writing ordinary markup.
  const PRIMITIVES = [
    'src/components/ui/input.tsx',
    'src/components/ui/select.tsx',
  ]

  for (const file of PRIMITIVES) {
    it(`${file} applies min-h-touch`, () => {
      expect(read(file)).toContain('min-h-touch')
    })
  }

  it('Button applies it to md and lg, and keeps sm dense on purpose', () => {
    const src = read('src/components/ui/button.tsx')
    // Matched against the whole file, not a scoped size block: the block
    // carries explanatory comments, and a regex that has to step over them is
    // exactly the kind that quietly matches nothing and reports a pass.
    //
    // Note `\\s`, not `\s`: inside a template literal `\s` is not a valid
    // escape and collapses to a bare `s`, which is how the first version of
    // this helper came to search for `md:s*'...'` and find nothing.
    const line = (name: string) => {
      const m = src.match(new RegExp(`\\b${name}:\\s*'([^']*)'`))
      expect(m, `no \`${name}\` size variant found in button.tsx`).toBeTruthy()
      return m![1]
    }

    expect(line('md'), 'the default button size must reach the floor').toContain('min-h-touch')
    expect(line('lg')).toContain('min-h-touch')
    // `sm` is the deliberate exception: a dense control for table rows, where
    // a 44px button would push every row apart. It is opt-in, so it must not
    // be what a plain <Button> gives you.
    expect(src).toMatch(/defaultVariants:\s*\{[^}]*size:\s*'md'/)
  })

  it('the icon-only shell controls cannot be shrunk by a caller', () => {
    // These take their size from the call site as h-10 w-10 (37.5px). The
    // minimum lives in the component so the call site cannot undo it.
    expect(read('src/components/CartIconLink.tsx')).toContain('min-h-touch min-w-touch')
    expect(read('src/components/layout/NotificationsBell.tsx')).toContain('min-h-touch min-w-touch')
  })
})

describe('no interactive control relies on a rem class for its touch floor', () => {
  function tsxFiles(dir: string): string[] {
    const out: string[] = []
    for (const name of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${name}`
      if (statSync(join(ROOT, rel)).isDirectory()) out.push(...tsxFiles(rel))
      else if (name.endsWith('.tsx')) out.push(rel)
    }
    return out
  }

  it('min-h-11 and min-h-10 appear in no className', () => {
    // The exact classes that read as >=44px and are not. A comment mentioning
    // them is fine and expected; a className is the bug.
    const offenders: string[] = []
    for (const file of tsxFiles('src')) {
      const src = read(file)
      for (const m of src.matchAll(/className=(?:"([^"]*)"|\{[^}]*?'([^']*)')/g)) {
        const cls = m[1] ?? m[2] ?? ''
        if (/\bmin-h-(10|11)\b/.test(cls)) offenders.push(`${file}: ${cls.slice(0, 60)}`)
      }
    }
    expect(
      offenders,
      'Use min-h-touch. These classes render at 37.5px and 41.25px at a '
        + `${ROOT_FONT_PX}px root font:\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('no anchor tries to build a hit area out of vertical padding alone', () => {
    // `-my-2 ... py-2` on an inline <a> is the idiom that keeps producing
    // 34px: padding does not grow an inline box. It needs touch-target (or
    // an explicit inline-flex) for the height to mean anything.
    const offenders: string[] = []
    for (const file of tsxFiles('src')) {
      for (const m of read(file).matchAll(/className=(?:"([^"]*)"|\{[^}]*?'([^']*)')/g)) {
        const cls = m[1] ?? m[2] ?? ''
        if (!/-my-\d/.test(cls) || !/\bpy-\d/.test(cls)) continue
        const grows = /touch-target|min-h-touch|\binline-flex\b|\bflex\b|\bgrid\b|\bblock\b|\binline-block\b/.test(cls)
        if (!grows) offenders.push(`${file}: ${cls.slice(0, 70)}`)
      }
    }
    expect(
      offenders,
      'Vertical padding cannot grow an inline box. Add `touch-target`:\n'
        + offenders.join('\n'),
    ).toEqual([])
  })
})
