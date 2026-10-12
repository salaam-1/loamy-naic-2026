import { en } from '../../src/lib/i18n/packs/en'
import { translate } from '../../src/lib/i18n'
import { LOCALES } from '../../src/lib/i18n/types'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { isInstitutionalProfile } from '../../src/lib/roles'

/**
 * Role-aware refinement pass.
 *
 * Each block pins one of the seven reported issues so it cannot quietly come
 * back. Where the concept is already covered by an existing suite this extends
 * that rather than starting a parallel style.
 */

// ---------------------------------------------------------------------------
// Institutional vs marketplace identity
// ---------------------------------------------------------------------------
describe('institutional accounts have no marketplace shopfront', () => {
  it('treats a bank officer as institutional', () => {
    expect(isInstitutionalProfile({ platform_role: 'bank', role: 'member' })).toBe(true)
  })

  it('treats a platform administrator as institutional', () => {
    expect(isInstitutionalProfile({ platform_role: 'farmer', role: 'admin' })).toBe(true)
  })

  it('leaves every marketplace role alone', () => {
    for (const platform_role of [
      'farmer', 'trader', 'buyer', 'exporter', 'input_supplier',
      'growth_partner', 'logistics_provider', 'warehouse_owner', 'processor',
    ]) {
      expect(isInstitutionalProfile({ platform_role, role: 'member' }), platform_role).toBe(false)
    }
  })

  it('does not throw on a missing profile', () => {
    expect(isInstitutionalProfile(null)).toBe(false)
    expect(isInstitutionalProfile(undefined)).toBe(false)
  })

  it('gates the handle card with a real condition, not CSS', () => {
    const settings = readFileSync('src/pages/shared/Settings.tsx', 'utf8')
    expect(settings).toContain('isInstitutionalProfile(profile)')
    // The component must not merely be hidden: a `hidden`/`sr-only` wrapper
    // would still mount it and still fire its availability lookups.
    expect(settings).not.toMatch(/className="[^"]*hidden[^"]*"[^>]*>\s*<UsernameCard/)
  })

  it('the database refuses a bank handle, and deliberately not an admin one', () => {
    const sql = readFileSync('supabase/migrations/20260925100002_loamy_username_marketplace_only.sql', 'utf8')
    expect(sql).toContain("if v_prole = 'bank' then")
    // The admin flag is an overlay on a real platform role, so an administrator
    // who is also a farmer keeps the handle they are entitled to.
    expect(sql).not.toMatch(/v_role\s*=\s*'admin'/)
    // Everything that protected the original must survive the replacement.
    for (const kept of ['loamy_is_active', '30 days', 'username_history', 'loamy_audit_internal', 'unique_violation']) {
      expect(sql, kept).toContain(kept)
    }
  })
})

// ---------------------------------------------------------------------------
// Activate facility
// ---------------------------------------------------------------------------
describe('activate facility accepts the states the product produces', () => {
  const sql = readFileSync('supabase/migrations/20260925100001_loamy_activate_facility_decision_states.sql', 'utf8')

  it('accepts every decided AND fundable status', () => {
    expect(sql).toContain("v_app.status not in ('approved', 'partially_approved', 'decided_external')")
  })

  it('still refuses the decided but NOT fundable ones', () => {
    // rejected / expired / cancelled are decided; none may open a facility.
    // They are excluded by the allow-list above, so assert the allow-list shape
    // rather than their absence, which any typo would satisfy.
    for (const forbidden of ['rejected', 'expired', 'cancelled']) {
      expect(sql.includes(`'${forbidden}'`), forbidden).toBe(false)
    }
  })

  it('keeps bank and actor identity server-derived', () => {
    expect(sql).toContain('public.loamy_officer_bank()')
    expect(sql).toContain('auth.uid()')
    // No client-supplied bank, actor or provenance parameter was introduced.
    expect(sql).not.toMatch(/p_bank|p_actor|p_officer|p_decision_source/)
  })

  it('is idempotent rather than raising a raw unique violation', () => {
    expect(sql).toContain('select id into v_fac from public.facilities where application_id = p_application')
    expect(sql).toContain('on conflict (application_id) do nothing')
  })

  it('preserves the audit row and the applicant notification', () => {
    expect(sql).toContain("loamy_audit_internal('facility_activated'")
    expect(sql).toContain('loamy_create_notification_internal')
  })

  it('the UI still offers exactly the states the function now accepts', () => {
    const ui = readFileSync('src/pages/bank/BankLoans.tsx', 'utf8')
    expect(ui).toContain("['approved', 'partially_approved', 'decided_external']")
    // And it must go through the RPC, not write financial state directly.
    expect(ui).toContain("rpc('loamy_activate_facility'")
    expect(ui).not.toMatch(/from\('facilities'\)\s*\.\s*(insert|update|delete)/)
  })

  it('blocks a duplicate submit while one is in flight', () => {
    const ui = readFileSync('src/pages/bank/BankLoans.tsx', 'utf8')
    expect(ui).toContain('loading={busy}')
    expect(ui).toContain('setBusy(true)')
  })

  it('surfaces a failure instead of swallowing it', () => {
    const ui = readFileSync('src/pages/bank/BankLoans.tsx', 'utf8')
    expect(ui).toContain('if (rpcErr) return setError(rpcErr.message)')
  })
})

// ---------------------------------------------------------------------------
// Logistics hero
// ---------------------------------------------------------------------------
describe('every role dashboard has a hero image', () => {
  const home = readFileSync('src/pages/shared/Home.tsx', 'utf8')

  // PLATFORM_ROLE_SLUGS is the authoritative list. An earlier version of this
  // scraped two-space-indented keys out of roles.ts and picked up the `profile:`
  // parameter of isInstitutionalProfile as though it were a role.
  function declaredRoles(): string[] {
    const types = readFileSync('src/lib/types.ts', 'utf8')
    const block = types.slice(types.indexOf('PLATFORM_ROLE_SLUGS'))
    const list = block.slice(block.indexOf('['), block.indexOf(']'))
    return [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).filter((r) => r !== 'onboarding')
  }

  function mappedRoles(section: string): string[] {
    const start = home.indexOf(`const ${section}`)
    const end = home.indexOf('}', home.indexOf('{', start))
    return [...home.slice(start, end).matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1])
  }

  it('maps an image for every dashboard role', () => {
    // logistics_provider, warehouse_owner and processor were missing, and the
    // map is Partial<> so TypeScript never said so. HomeHero then fell back to
    // a flat bg-env-sage panel, which is the empty block that was reported.
    const missing = declaredRoles().filter((r) => !mappedRoles('HERO_IMAGE').includes(r))
    expect(missing).toEqual([])
  })

  it('maps alt text for every dashboard role', () => {
    const missing = declaredRoles().filter((r) => !mappedRoles('HERO_ALT').includes(r))
    expect(missing).toEqual([])
  })

  it('gives logistics and processing their OWN photograph, not a borrowed one', () => {
    // The brief for this pass: a haulier and a miller must not be shown the
    // farmer's picture, or each other's. Asserted on the mapping rather than
    // on a screenshot so it cannot rot silently.
    const pathFor = (role: string) => {
      const m = home.match(new RegExp('^  ' + role + ": '([^']+)'", 'm'))
      return m ? m[1] : null
    }
    const farmer = pathFor('farmer')
    const logistics = pathFor('logistics_provider')
    const processor = pathFor('processor')

    expect(logistics, 'logistics_provider has no hero image').toBeTruthy()
    expect(processor, 'processor has no hero image').toBeTruthy()
    expect(logistics, 'logistics reuses the farmer photograph').not.toBe(farmer)
    expect(processor, 'processor reuses the farmer photograph').not.toBe(farmer)
    expect(logistics, 'logistics and processing share one photograph').not.toBe(processor)
  })

  it('describes each of those photographs for a screen reader', () => {
    const altFor = (role: string) => {
      const start = home.indexOf('const HERO_ALT')
      const block = home.slice(start, home.indexOf('}', home.indexOf('{', start)))
      const m = block.match(new RegExp('^  ' + role + ": '([^']+)'", 'm'))
      return m ? m[1] : null
    }
    // Alt text that still describes the old borrowed picture is worse than
    // none: it tells a screen-reader user something untrue.
    expect(altFor('logistics_provider')).toMatch(/truck|lorry|load/i)
    expect(altFor('processor')).toMatch(/process|mill|cassava|machine/i)
  })

  it('points only at assets that exist in the repository', () => {
    const paths = [...home.matchAll(/'(\/images\/[a-z0-9-]+\.jpg)'/g)].map((m) => m[1])
    expect(paths.length).toBeGreaterThan(0)
    for (const path of new Set(paths)) {
      expect(() => readFileSync(`public${path}`), path).not.toThrow()
    }
  })
})

// ---------------------------------------------------------------------------
// One page heading, owned by the shell
// ---------------------------------------------------------------------------
describe('page heading hierarchy', () => {
  it('the shell can own an H1, and does so explicitly', () => {
    const shell = readFileSync('src/components/layout/AppShell.tsx', 'utf8')
    expect(shell).toContain('pageTitle')

    // Asserted as three properties rather than as one literal expression.
    // The previous version matched `<h1>{pageTitle}</h1>` exactly, which made
    // it fail the moment the heading started being TRANSLATED -- a correct
    // change it had no opinion about. What it is actually there to protect is
    // that the shell renders exactly one H1, only when it has a title, and
    // that the title it renders comes from `pageTitle`.
    const h1s = [...shell.matchAll(/<h1\b/g)]
    expect(h1s.length, 'the shell must own exactly one H1').toBe(1)

    // Guarded, so a page that brings its own heading does not get two.
    expect(shell).toMatch(/\{pageTitle && \(/)

    // And the heading's content is derived from pageTitle, whatever wraps it.
    const heading = shell.slice(shell.indexOf('<h1'))
    const body = heading.slice(0, heading.indexOf('</h1>'))
    expect(body, 'the H1 must render the pageTitle it was given').toContain('pageTitle')
  })

  it('bank and admin shells supply one', () => {
    expect(readFileSync('src/pages/bank/BankShell.tsx', 'utf8')).toContain('pageTitle=')
    expect(readFileSync('src/pages/Admin.tsx', 'utf8')).toContain('pageTitle=')
  })

  it('the member overview does NOT, because HomeHero already renders it', () => {
    const dash = readFileSync('src/pages/RoleDashboard.tsx', 'utf8')
    expect(dash).toContain("section === 'overview'")
    expect(readFileSync('src/components/home/HomeHero.tsx', 'utf8')).toMatch(/<h1/)
  })
})

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------
/**
 * The words each language uses for LENDING, so "Loamy is not a lender" can be
 * checked wherever it has actually been translated.
 *
 *   fr  prêteur          ha  rance (ba ya ba da rance)
 *   ig  agbazinye (ego)  yo  yá owó
 *
 * Listed rather than inferred: the first version of this guard matched only
 * the English and French words, and read a correct Igbo disclaimer as a
 * dropped clause. A language missing from here is a language whose disclaimer
 * nobody is checking, so adding one is a deliberate act.
 */
const LENDER_CLAIM = /pr[êe]teur|rance|lender|agbazinye|y[áa] ow[óo]/i

describe('public footer', () => {
  const shell = readFileSync('src/pages/public/PublicShell.tsx', 'utf8')
  // Comments stripped FIRST. The footer carries a long JSX comment explaining
  // where the image attribution lives, and it names the credits path -- so a
  // raw slice let an assertion about the rendered LINK be satisfied by the
  // comment that merely talks about it. Deleting the link left this green.
  const footerSrc = shell.slice(shell.indexOf('<footer'), shell.indexOf('</footer>'))
  const footer = footerSrc
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  it('keeps the legally required CC BY-SA attribution reachable', () => {
    // Phase 7 removed the paragraph of creator names from the footer and
    // replaced it with a link. CC BY-SA 4.0 clause 3(a)(2) allows exactly
    // that: the conditions may be met "in any reasonable manner based on the
    // medium, means, and context", and linking to a resource that carries the
    // information is the licence's own example.
    //
    // So the obligation did not go away, it moved, and so does the assertion.
    // The footer must still point at the attribution, and the attribution must
    // still name the creators and the licence. tests/unit/image-credits.test.ts
    // holds the rest of that contract.
    expect(footer, 'the footer must link to the credits').toContain('/images/IMAGE-CREDITS.md')

    const credits = readFileSync('public/images/IMAGE-CREDITS.md', 'utf8')
    expect(credits).toContain('creativecommons.org/licenses/by-sa/4.0')
    for (const creator of ['Photobyamin', 'SMMIMAGES', 'OnyekeEjike']) {
      expect(credits, creator).toContain(creator)
    }
  })

  it('links the full per-file credits rather than inlining them', () => {
    expect(footer).toContain('/images/IMAGE-CREDITS.md')
    // The long per-photograph titles are gone from the footer itself.
    expect(footer).not.toContain('Rice harvest from the farm')
    expect(footer).not.toContain('Dawanau Market')
  })

  it('keeps ownership, copyright, privacy policy and preferences', () => {
    expect(footer).toContain('Braventi')
    expect(footer).toContain('2026')
    expect(footer).toContain('Privacy preferences')
    expect(shell).toContain('LEGAL_NAV')
  })

  it('drops the bare corporate URL, which the ownership line already covers', () => {
    expect(footer).not.toContain('braventiholdings.com.ng')
  })

  it('keeps both legal claims in the disclaimer, in every language', () => {
    // The sentence moved out of src/pages/public/copy.ts and into the
    // localization packs, because a disclaimer that only exists in English is
    // not shown to a member reading the site in Hausa. The assertion follows
    // it, and is stronger for it: the claim is now checked in EVERY locale,
    // through the same fallback the interface uses.
    expect(en['public.disclaimer']).toContain('not a lender')
    expect(en['public.disclaimer']).toMatch(/regulated payment partner/)

    for (const loc of LOCALES) {
      const rendered = translate(loc, 'public.disclaimer')
      expect(rendered.length, loc).toBeGreaterThan(40)
      // Either the pack carries both claims, or it falls back to the English
      // that does. A half-translated disclaimer is the thing to catch.
      const isEnglishFallback = rendered === en['public.disclaimer']
      if (!isEnglishFallback) {
        expect(rendered, `${loc} disclaimer dropped the lender claim`).toMatch(LENDER_CLAIM)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// One Loamy header: no nested shells
// ---------------------------------------------------------------------------
describe('exactly one global Loamy identity', () => {
  const sections = readFileSync('src/pages/shared/sections.ts', 'utf8')
  const dashboard = readFileSync('src/pages/RoleDashboard.tsx', 'utf8')

  /** Every component RoleDashboard renders INSIDE its own AppShell. */
  function componentsInsideTheShell(): string[] {
    const registered = [...sections.matchAll(/cmp:\s*([A-Za-z]+)/g)].map((m) => m[1])
    // Plus the ones RoleDashboard renders inline in its fallback chain.
    const inline = [...dashboard.matchAll(/\?\s*\(\s*<([A-Z][A-Za-z]*)\s*\/>/g)].map((m) => m[1])
    return [...new Set([...registered, ...inline])]
  }

  /** Where a component lives, from whichever file imports it. */
  function fileFor(name: string): string | null {
    for (const src of [sections, dashboard]) {
      const m = src.match(new RegExp(`import (?:\{ )?${name}(?: \})? from '@/([^']+)'`))
      if (m) {
        for (const ext of ['.tsx', '.ts']) {
          try {
            readFileSync(`src/${m[1]}${ext}`, 'utf8')
            return `src/${m[1]}${ext}`
          } catch { /* try the next extension */ }
        }
      }
    }
    return null
  }

  it('finds the components it is supposed to be checking', () => {
    // Guards the guard: a broken import regex would make this vacuously green.
    const resolved = componentsInsideTheShell().map(fileFor).filter(Boolean)
    expect(resolved.length).toBeGreaterThan(10)
  })

  it('no in-shell component renders a second shell', () => {
    // RoleShell IS an AppShell. Rendering one inside RoleDashboard nested two
    // shells and painted two complete Loamy headers stacked on mobile, which
    // is what the reported screenshot showed on My Stock.
    const offenders: string[] = []
    for (const name of componentsInsideTheShell()) {
      const file = fileFor(name)
      if (!file) continue
      if (readFileSync(file, 'utf8').includes('<RoleShell')) offenders.push(`${name} (${file})`)
    }
    expect(offenders).toEqual([])
  })

  it('leaves RoleShell in place for genuine deep routes', () => {
    // Those are NOT inside RoleDashboard, so they supply their own chrome.
    for (const f of [
      'src/pages/marketplace/ListingDetail.tsx',
      'src/pages/marketplace/CartPage.tsx',
      'src/pages/partner/FieldOps.tsx',
    ]) {
      expect(readFileSync(f, 'utf8'), f).toContain('<RoleShell')
    }
  })

  it('AppShell is the only component that paints the wordmark chrome', () => {
    const shell = readFileSync('src/components/layout/AppShell.tsx', 'utf8')
    expect(shell).toContain('<Logo')
    // RoleShell must delegate rather than draw its own header.
    const roleShell = readFileSync('src/pages/shared/RoleShell.tsx', 'utf8')
    expect(roleShell).toContain('AppShell')
    expect(roleShell).not.toContain('<Logo')
  })
})

// ---------------------------------------------------------------------------
// Exactly one h1: the shell and the page must not both supply one
// ---------------------------------------------------------------------------
describe('heading ownership is declared, not guessed', () => {
  const sections = readFileSync('src/pages/shared/sections.ts', 'utf8')

  /** section slug -> component file, from the registry and its imports. */
  function sectionFiles(): Array<[string, string]> {
    const out: Array<[string, string]> = []
    for (const m of sections.matchAll(/'?([a-z-]+)'?:\s*\{\s*cmp:\s*([A-Za-z]+)/g)) {
      const [, slug, cmp] = m
      const imp = sections.match(new RegExp(`import (?:\{ )?${cmp}(?: \})? from '@/([^']+)'`))
      if (!imp) continue
      for (const ext of ['.tsx', '.ts']) {
        try {
          readFileSync(`src/${imp[1]}${ext}`, 'utf8')
          out.push([slug, `src/${imp[1]}${ext}`])
          break
        } catch { /* next extension */ }
      }
    }
    // RoleDashboard renders these two itself rather than through the registry.
    const dash = readFileSync('src/pages/RoleDashboard.tsx', 'utf8')
    for (const [slug, cmp] of [['intelligence', 'MarketIntelligence'], ['invite', 'InviteBenefits']]) {
      const imp = dash.match(new RegExp(`import (?:\{ )?${cmp}(?: \})? from '@/([^']+)'`))
      if (imp) out.push([slug, `src/${imp[1]}.tsx`])
    }
    return out
  }

  it('resolves the section components it checks', () => {
    expect(sectionFiles().length).toBeGreaterThan(10)
  })

  it('SECTIONS_WITH_OWN_HEADING matches the components that actually have an h1', () => {
    const declared = new Set(
      [...sections.matchAll(/SECTIONS_WITH_OWN_HEADING[\s\S]*?\[([\s\S]*?)\]/g)]
        .flatMap((m) => [...m[1].matchAll(/'([a-z-]+)'/g)].map((x) => x[1])),
    )
    const actual = new Set(
      sectionFiles().filter(([, file]) => readFileSync(file, 'utf8').includes('<h1')).map(([slug]) => slug),
    )
    // Both directions: an undeclared h1 duplicates the title, and a stale entry
    // leaves a section with no heading at all.
    expect([...actual].filter((s2) => !declared.has(s2)), 'section renders an h1 but is not declared').toEqual([])
    expect([...declared].filter((s2) => !actual.has(s2)), 'declared but no longer renders an h1').toEqual([])
  })

  it('that h1 renders in EVERY state, not only when the data has loaded', () => {
    // WHAT THIS DOES AND DOES NOT PROVE.
    //   It catches the ORIGINAL shape of the bug: an <h1> written inline in
    //   the populated branch, below a guard that returns a skeleton or an
    //   empty state. A new section written that way is flagged here.
    //
    //   It does NOT protect the six components already fixed. Their heading
    //   is now a const declared above the branches, so <h1> appears before
    //   any early return and this check passes whether or not the branches
    //   actually render it. Verified by reintroducing the bug: this test
    //   still passed, and only the rendered-branch test failed.
    //
    //   The real guarantee is tests/components/section-heading-branches.test.tsx,
    //   which mounts each section and asserts the heading reaches the DOM in
    //   the loading, empty and populated branches. Do not treat this one as a
    //   substitute for it.
    // The gap this closes: the check above is satisfied by a file that merely
    // CONTAINS an <h1>. Every one of these sections used to return a loading
    // skeleton (and several an empty state) before reaching its heading, so a
    // page with no listings, or one still fetching, had no heading at all while
    // RoleDashboard was suppressing its own on the promise that one exists.
    // An early return is a return indented inside a guard, above the heading.
    const offenders: string[] = []
    for (const [slug, file] of sectionFiles()) {
      const src = readFileSync(file, 'utf8')
      const lines = src.split(/\r?\n/)
      const h1 = lines.findIndex((l) => l.includes('<h1'))
      if (h1 < 0) continue
      const early = lines.slice(0, h1).some((l) => /^ {4}return\b/.test(l))
      if (early) offenders.push(slug + ' (' + file + ')')
    }
    expect(offenders, 'section returns before it renders its heading').toEqual([])
  })

  it('the shell skips its heading for those sections and the overview', () => {
    const dash = readFileSync('src/pages/RoleDashboard.tsx', 'utf8')
    expect(dash).toContain('SECTIONS_WITH_OWN_HEADING.has(section)')
    expect(dash).toContain("section === 'overview'")
  })
})
