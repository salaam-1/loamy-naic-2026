import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HOMEPAGE_PREVIEW_LIMIT, HOMEPAGE_PREVIEW_COLUMNS } from '../../src/pages/public/Landing'
import {
  HOMEPAGE_MARKETPLACE_LIMIT, MARKETPLACE_BROWSE_LIMIT, PUBLIC_CARD_COLUMNS,
} from '../../src/lib/marketplace'

/**
 * The homepage is a shop window, not the shop.
 *
 * A visitor has to reach the footer without scrolling past the catalogue, and
 * that must hold when the marketplace has fifty listings and when it has fifty
 * thousand. The only way that stays true is if the bound is in the QUERY: six
 * rows cross the wire and there is nothing on the client to slice.
 *
 * This is written as source assertions on purpose. The failure it guards
 * against is someone widening the read -- dropping `.limit()`, going back to
 * `select('*')`, or fetching everything and slicing -- and none of those look
 * wrong on a staging database with twelve listings. A behavioural test against
 * a small dataset would pass while the production homepage pulled everything.
 */

const ROOT = join(__dirname, '..', '..')
const LANDING = 'src/pages/public/Landing.tsx'
const src = readFileSync(join(ROOT, LANDING), 'utf8')

/** `/` renders this, and `/marketplace` renders the same file unbounded. */
const STOREFRONT = 'src/pages/public/PublicMarketplace.tsx'
const MARKETPLACE_LIB = 'src/lib/marketplace.ts'
const APP = 'src/App.tsx'

function stripped(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const storefront = stripped(STOREFRONT)
const marketplaceLib = stripped(MARKETPLACE_LIB)
const app = stripped(APP)

/** Source with comments removed, so a comment cannot satisfy an assertion. */
const code = src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

describe('the homepage listing read is bounded at the query', () => {
  it('asks for a small, deliberate number of listings', () => {
    expect(HOMEPAGE_PREVIEW_LIMIT).toBeGreaterThan(0)
    // Big enough to fill the grid, small enough that the footer is never far.
    // If this ever needs to exceed a dozen, the homepage has become the
    // marketplace and should link to it instead.
    expect(HOMEPAGE_PREVIEW_LIMIT).toBeLessThanOrEqual(12)
  })

  it('applies that limit in the query, not after it', () => {
    expect(code, 'the homepage query lost its .limit()').toContain('.limit(HOMEPAGE_PREVIEW_LIMIT)')
  })

  it('never slices a listings result on the client', () => {
    // `.slice(0, n)` over a fetched array is the shape this guards against:
    // the rows have already crossed the wire by then, so the page is as slow
    // and as large as the whole table.
    const slices = [...code.matchAll(/\.slice\(\s*0\s*,\s*\d+\s*\)/g)]
    expect(
      slices.map((m) => m[0]),
      'Bound the query instead of slicing the result.',
    ).toEqual([])
  })

  it('selects named columns rather than everything', () => {
    expect(code, "the homepage went back to select('*')").not.toMatch(/\.select\(\s*['"`]\*/)
    expect(code).toContain('.select(HOMEPAGE_PREVIEW_COLUMNS)')
    // Named columns only, no star smuggled into the constant.
    expect(HOMEPAGE_PREVIEW_COLUMNS).not.toContain('*')
    expect(HOMEPAGE_PREVIEW_COLUMNS.split(',').length).toBeGreaterThan(3)
  })

  it('orders totally, so the same data renders in the same order', () => {
    // `created_at` alone is not a total order: listings written in one
    // transaction share a timestamp, and Postgres may then return them in
    // either order. The homepage would reshuffle between loads.
    expect(code).toContain("order('created_at'")
    expect(code, 'ordering needs a tiebreaker after created_at').toContain("order('id'")
  })

  it('offers a route to the full marketplace', () => {
    expect(code).toContain("to=\"/marketplace\"")
    expect(code).toContain('public.seeAllListings')
  })

  it('does not put the footer behind an unbounded list', () => {
    // The preview section renders at most HOMEPAGE_PREVIEW_LIMIT cards, and
    // the sections after it are fixed. Asserted by absence: no pagination, no
    // infinite scroll and no "load more" on the landing page.
    expect(code).not.toMatch(/IntersectionObserver|infinite|loadMore|fetchMore/i)
  })
})

/**
 * The HOMEPAGE PROPER, which is not the same page as the one above.
 *
 * `/welcome` is the old marketing page and the block above guards it. `/` is
 * the public marketplace storefront, and it rendered SIXTY rows with
 * `select('*')`: the landing page WAS the catalogue, and the footer sat below
 * all of it.
 *
 * `/` and `/marketplace` are the same component. The only difference is a
 * `preview` prop, which picks a reader that cannot be asked for more than
 * twelve rows. That is why these assertions are mostly about the reader rather
 * than about the component: the component can no longer widen the read even if
 * somebody tries.
 */
describe('the storefront homepage preview is bounded at the query', () => {
  it('caps the homepage at a dozen listings', () => {
    expect(HOMEPAGE_MARKETPLACE_LIMIT).toBe(12)
    // Four rows of three at xl, six of two at sm, and then the page moves on.
    expect(HOMEPAGE_MARKETPLACE_LIMIT).toBeLessThan(MARKETPLACE_BROWSE_LIMIT)
  })

  it('the homepage reader takes no limit argument at all', () => {
    /**
     * The bound is STRUCTURAL. A reader with a `limit` parameter is a reader
     * whose bound is whatever the next caller passes, and the whole failure
     * this guards against is somebody raising that number because the grid
     * looked sparse.
     */
    const fn = /export async function getHomepageMarketplaceListings\(([\s\S]*?)\)/
      .exec(marketplaceLib)
    expect(fn, 'getHomepageMarketplaceListings is gone').toBeTruthy()
    expect(fn![1], 'the homepage reader accepts a limit').not.toMatch(/\blimit\b/)
    expect(marketplaceLib).toContain('fetchPublicListings(filters, HOMEPAGE_MARKETPLACE_LIMIT)')
  })

  it('the homepage route passes preview, and /marketplace does not', () => {
    expect(app, '/ is no longer the bounded preview').toContain('<PublicMarketplace preview />')
    expect(app, '/marketplace must stay the full surface')
      .toContain('path="/marketplace" element={<PublicMarketplace />}')
  })

  it('no unbounded listing read remains in the storefront', () => {
    // Every `.select(` in the component, with the chain it belongs to, must
    // carry a limit. The category-count read is bounded too; it asks for one
    // column and exists to count.
    expect(storefront, "the storefront went back to select('*')")
      .not.toMatch(/\.select\(\s*['"`]\*/)
    expect(storefront, 'the 60-row homepage read is back').not.toContain('.limit(60)')
    for (const m of storefront.matchAll(/supabase\s*\n?\s*\.from\(/g)) {
      const chain = storefront.slice(m.index, m.index + 400)
      expect(chain, `an unbounded read at index ${m.index}`).toMatch(/\.limit\(/)
    }
  })

  it('the shared reader selects named columns, never a star', () => {
    expect(PUBLIC_CARD_COLUMNS).not.toContain('*')
    // The fifteen fields PublicProductCard renders.
    expect(PUBLIC_CARD_COLUMNS.split(',').length).toBe(15)
    for (const field of ['id', 'commodity', 'price_per_unit', 'photos', 'claim_basis']) {
      expect(PUBLIC_CARD_COLUMNS, `${field} is not selected`).toContain(field)
    }
    // Nothing the card does not render, and nothing the view withholds anyway.
    for (const leak of ['seller_id', 'phone', 'email', 'latitude', 'longitude']) {
      expect(PUBLIC_CARD_COLUMNS, `${leak} must never be selected`).not.toContain(leak)
    }
  })

  it('orders totally, so a bounded page does not reshuffle', () => {
    expect(marketplaceLib).toContain("order('created_at'")
    expect(marketplaceLib, 'ordering needs a tiebreaker').toContain("order('id'")
  })

  it('adds no eligibility rule of its own', () => {
    /**
     * `loamy_public_listings` is defined `where l.status = 'active'`, so
     * active-and-public is enforced in the database for every caller. A second
     * copy of the rule in the client is how two definitions drift apart, and
     * the client one would be the easier to forget.
     */
    expect(marketplaceLib, 'status filtering belongs to the view, not the client')
      .not.toMatch(/eq\(\s*['"`]status['"`]/)
  })

  it('never slices a listings result on the client', () => {
    const slices = [...storefront.matchAll(/\.slice\(\s*0\s*,\s*\d+\s*\)/g)]
    expect(slices.map((m) => m[0]), 'Bound the query instead of slicing.').toEqual([])
  })

  it('adds no infinite scroll, auto-load or load-more to the homepage', () => {
    expect(storefront).not.toMatch(/IntersectionObserver|infinite|loadMore|fetchMore|useInView/i)
  })

  it('points the preview CTA at the existing full marketplace route', () => {
    expect(storefront).toContain('to="/marketplace"')
    expect(storefront).toContain('marketplace.preview.exploreAll')
    // Not a modal, not a drawer, not a second catalogue page.
    expect(storefront).not.toMatch(/Modal|Drawer|Sheet|Dialog/)
  })

  it('renders the CTA only in preview mode', () => {
    // On /marketplace the link would point at the page you are already on.
    expect(storefront).toMatch(/preview && rows !== null && rows\.length > 0/)
  })
})
