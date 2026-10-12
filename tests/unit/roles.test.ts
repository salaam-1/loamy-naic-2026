import { describe, expect, it } from 'vitest'
import { ALL_ROLE_CONFIGS, PROCUREMENT_ROLES, ROLE_CONFIGS, SIGNUP_ROLE_CONFIGS } from '@/lib/roles'
import { DEFAULT_FLAGS, PLATFORM_ROLE_SLUGS, type PlatformRole } from '@/lib/types'
import { INTEREST_ROLES, MARKETPLACE_ROLES, SELLER_ROLES } from '@/lib/marketplace'
import { addableRoles, switchableRoles, type HeldRole } from '@/lib/userRoles'

const held = (role: PlatformRole, onboarded = true): HeldRole =>
  ({ role, onboarded, added_at: '2026-01-01T00:00:00Z' })

describe('role configuration', () => {
  it('defines a config for every platform role', () => {
    for (const slug of PLATFORM_ROLE_SLUGS) {
      expect(ROLE_CONFIGS[slug], `missing config for ${slug}`).toBeTruthy()
      expect(ROLE_CONFIGS[slug].slug).toBe(slug)
    }
  })

  it('gives every role a wallet, profile, support and settings section', () => {
    for (const cfg of ALL_ROLE_CONFIGS) {
      const sections = cfg.nav.map((n) => n.section)
      for (const required of ['wallet', 'profile', 'support', 'settings']) {
        expect(sections, `${cfg.slug} is missing ${required}`).toContain(required)
      }
    }
  })

  it('never lists the same nav section twice for a role', () => {
    // Regression guard: nav is assembled by splicing shared items into each
    // config at module load. A shared ARRAY (rather than a per-role one) would
    // receive the same item twice and show duplicate sidebar entries.
    for (const cfg of ALL_ROLE_CONFIGS) {
      const sections = cfg.nav.map((n) => n.section)
      expect(new Set(sections).size, `${cfg.slug} has duplicate nav sections`).toBe(sections.length)
    }
  })

  it('keeps trader and buyer nav arrays independent objects', () => {
    // They render the same merged config but MUST NOT share the array, or the
    // splice passes mutate both.
    expect(ROLE_CONFIGS.trader.nav).not.toBe(ROLE_CONFIGS.buyer.nav)
    expect(ROLE_CONFIGS.trader.label).toBe(ROLE_CONFIGS.buyer.label)
  })

  it('offers every role except the legacy buyer slug at signup', () => {
    const slugs = SIGNUP_ROLE_CONFIGS.map((r) => r.slug)
    expect(slugs).not.toContain('buyer')
    expect(slugs).toContain('trader')
    expect(slugs.length).toBe(PLATFORM_ROLE_SLUGS.length - 1)
  })

  it('gives every procurement role the sections the suite needs', () => {
    for (const slug of PROCUREMENT_ROLES) {
      const sections = ROLE_CONFIGS[slug].nav.map((n) => n.section)
      for (const s of ['company', 'team', 'rfqs', 'contracts', 'inspections', 'logistics', 'analytics']) {
        expect(sections, `${slug} is missing ${s}`).toContain(s)
      }
    }
  })
})

describe('marketplace role sets', () => {
  it('keeps sellers and interest-senders inside the marketplace set', () => {
    for (const r of SELLER_ROLES) expect(MARKETPLACE_ROLES, `seller ${r}`).toContain(r)
    for (const r of INTEREST_ROLES) expect(MARKETPLACE_ROLES, `interest ${r}`).toContain(r)
  })

  it('treats the merged trader and buyer slugs identically', () => {
    for (const set of [MARKETPLACE_ROLES, SELLER_ROLES, INTEREST_ROLES]) {
      expect(set.includes('trader')).toBe(set.includes('buyer'))
    }
  })
})

describe('multi-role helpers', () => {
  it('folds the legacy buyer row into trader in the switcher', () => {
    const out = switchableRoles([held('trader'), held('buyer')])
    expect(out.map((r) => r.role)).toEqual(['trader'])
  })

  it('keeps a lone buyer row visible', () => {
    expect(switchableRoles([held('buyer')]).map((r) => r.role)).toEqual(['buyer'])
  })

  it('never offers buyer, or a role already held, as addable', () => {
    const out = addableRoles([held('trader'), held('farmer')])
    expect(out).not.toContain('buyer')
    expect(out).not.toContain('trader')
    expect(out).not.toContain('farmer')
    expect(out).toContain('warehouse_owner')
  })

  it('does not offer trader to an account already holding the legacy buyer slug', () => {
    expect(addableRoles([held('buyer')])).not.toContain('trader')
  })
})

describe('feature flags default to off, and one of them must stay that way', () => {
  it('ships every flag off', () => {
    // A flag that defaults ON reaches production the moment someone forgets
    // to set it, which is the opposite of what a flag is for.
    for (const [key, value] of Object.entries(DEFAULT_FLAGS)) {
      expect(value, `${key} must default to false`).toBe(false)
    }
  })

  it('never defaults copilot_predictions on', () => {
    // Loamy does not predict prices. The naive baseline beat every model
    // tried, so a forecast would be a confident-looking number with nothing
    // behind it. This is the one flag whose default is a product promise.
    expect(DEFAULT_FLAGS.copilot_predictions).toBe(false)
    expect(DEFAULT_FLAGS.copilot).toBe(false)
  })
})
