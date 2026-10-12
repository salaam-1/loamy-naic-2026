import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ALL_ROLE_CONFIGS } from '../../src/lib/roles'
import {
  PRIMARY_TABS, SECTION_TAB, TAB_META, groupNav, tabFor, tabLanding,
} from '../../src/lib/navigation'

const rolesSource = readFileSync(new URL('../../src/lib/roles.ts', import.meta.url), 'utf8')
const declaredSections = [...new Set(
  [...rolesSource.matchAll(/section: '([a-z-]+)'/g)].map((m) => m[1]),
)].sort()

describe('no section can fall out of navigation', () => {
  it('maps every section declared in roles.ts explicitly', () => {
    // The fallback in tabFor exists so a mistake is survivable, NOT so the
    // map can be incomplete. An unmapped section is a feature that quietly
    // stops being reachable from a phone.
    const unmapped = declaredSections.filter((s) => !(s in SECTION_TAB))
    expect(unmapped, `unmapped sections: ${unmapped.join(', ')}`).toEqual([])
  })

  it('maps nothing that does not exist', () => {
    // A stale key is how the map rots: it looks maintained while the section
    // it names has been gone for months.
    const stale = Object.keys(SECTION_TAB).filter((s) => !declaredSections.includes(s))
    expect(stale, `sections in the map that roles.ts no longer declares: ${stale.join(', ')}`).toEqual([])
  })

  it('never returns an undefined tab', () => {
    expect(PRIMARY_TABS).toContain(tabFor('a-section-nobody-has-written-yet'))
  })

  it('gives every tab a label and an icon', () => {
    for (const t of PRIMARY_TABS) {
      expect(TAB_META[t].label.length).toBeGreaterThan(0)
      expect(TAB_META[t].icon).toBeTruthy()
    }
  })

  it('keeps the tab bar to five, which is what fits a phone', () => {
    expect(PRIMARY_TABS).toHaveLength(5)
  })
})

describe('grouping a role nav', () => {
  it('loses no item', () => {
    // The property that matters most: grouping is a rearrangement, never a
    // filter. Anything dropped here is a screen the user can no longer reach.
    for (const config of ALL_ROLE_CONFIGS) {
      const grouped = groupNav(config.nav).flatMap((g) => g.items)
      expect(grouped.length, `${config.slug} lost items when grouped`).toBe(config.nav.length)
      expect(new Set(grouped.map((i) => i.section)).size).toBe(
        new Set(config.nav.map((i) => i.section)).size,
      )
    }
  })

  it('puts each item in exactly one tab', () => {
    for (const config of ALL_ROLE_CONFIGS) {
      const seen = new Map<string, number>()
      for (const g of groupNav(config.nav)) {
        for (const item of g.items) seen.set(item.section, (seen.get(item.section) ?? 0) + 1)
      }
      for (const [section, count] of seen) {
        expect(count, `${config.slug}/${section} appears in ${count} tabs`).toBe(1)
      }
    }
  })

  it('drops empty tabs rather than showing a dead one', () => {
    for (const config of ALL_ROLE_CONFIGS) {
      for (const g of groupNav(config.nav)) {
        expect(g.items.length, `${config.slug} has an empty ${g.tab} tab`).toBeGreaterThan(0)
      }
    }
  })

  it('preserves the order a role declared', () => {
    // A role's own sense of priority should survive grouping.
    for (const config of ALL_ROLE_CONFIGS) {
      for (const g of groupNav(config.nav)) {
        const positions = g.items.map((i) => config.nav.findIndex((n) => n.section === i.section))
        expect([...positions].sort((a, b) => a - b)).toEqual(positions)
      }
    }
  })

  it('gives every role a reachable landing section per tab', () => {
    for (const config of ALL_ROLE_CONFIGS) {
      for (const g of groupNav(config.nav)) {
        const landing = tabLanding(g)
        expect(landing, `${config.slug}/${g.tab} has no landing`).toBeTruthy()
        expect(config.nav.some((n) => n.section === landing!.section)).toBe(true)
      }
    }
  })

  it('gives every role a Home and a Profile tab', () => {
    // Two tabs every role must have: somewhere to land, and somewhere to
    // find settings and privacy. The other three are role-dependent.
    for (const config of ALL_ROLE_CONFIGS) {
      const tabs = groupNav(config.nav).map((g) => g.tab)
      expect(tabs, `${config.slug} has no home tab`).toContain('home')
      expect(tabs, `${config.slug} has no profile tab`).toContain('profile')
    }
  })
})
