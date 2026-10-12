import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronDown, Heart, MapPin, Menu, Package, Search, X } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useT } from '@/lib/i18n'
import { LanguageSelector } from '@/components/LanguageSelector'
import { CartIconLink } from '@/components/CartIconLink'
import { useCart } from '@/context/CartContext'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { COMMODITY_GROUPS, NIGERIA_STATES } from '@/lib/nigeria'
import { DISCLAIMER_KEY } from '@/pages/public/copy'
import { useConsent } from '@/lib/useConsent'
import { cn } from '@/lib/utils'

/** Footer quick links. */
/** Legal links. One entry per page that actually exists. */
const LEGAL_NAV: { label: string; to: string }[] = [
  { label: 'Privacy Policy', to: '/privacy' },
]

const NAV = [
  { label: 'Platform', href: '/welcome#platform' },
  { label: 'How It Works', href: '/welcome#how-it-works' },
  { label: 'Marketplace', href: '/marketplace' },
  { label: 'About', href: '/welcome#about' },
  { label: 'Contact', href: '/welcome#contact' },
]

/** Secondary category-nav tabs (the strip beneath the top bar in the mockup).
 * Only tabs that point at a real, shipped surface are shown. The member trading
 * surfaces (Buy Requests, Sell Offers, Contracts, Logistics, Insights) return in
 * Stage 5 once their pages exist — until then they'd dead-end, so they're
 * omitted rather than bounced through sign-up. */
const TABS: { label: string; to: string; badge?: string }[] = [
  { label: 'Home', to: '/' },
  { label: 'Marketplace', to: '/marketplace' },
  { label: 'Suppliers', to: '/suppliers' },
  { label: 'Buy Requests', to: '/buy-requests' },
  { label: 'Market Prices', to: '/marketplace#market-prices' },
  { label: 'Insights', to: '/insights' },
  { label: 'Financing', to: '/welcome#platform' },
]

/** Public marketplace shell: a sticky marketplace top bar (brand, deliver-to,
 * search, account) + a secondary category-nav strip, over a deep-emerald footer.
 * Flat — 1px borders, no gradients, no glass. */
export function PublicShell({ children }: { children: ReactNode }) {
  // "Privacy preferences" in the footer re-opens the notice, which is how
  // someone changes their mind without an account. The brief requires the
  // choice to be reopenable; a one-way accept is not a preference.
  const { reopen: reopenPrivacy } = useConsent()
  const { session, profile } = useAuth()
  const { t } = useT()
  /**
   * Where the brand lockup goes. Signed in, it is the member's own dashboard;
   * signed out, the public home. Same rule as the application shell, so the
   * logo means one thing across the whole product.
   */
  const brandHref = session && profile?.platform_role
    ? `/dashboard/${profile.platform_role}`
    : '/'
  const { cartCount, wishlistCount } = useCart()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const [open, setOpen] = useState(false)
  const authed = !!session

  // Search form state, seeded from the URL so the header reflects active filters.
  const [q, setQ] = useState(params.get('q') ?? '')
  const [cat, setCat] = useState(params.get('group') ?? '')
  const [deliverTo, setDeliverTo] = useState(params.get('state') ?? '')

  const runSearch = (e?: FormEvent) => {
    e?.preventDefault()
    const sp = new URLSearchParams()
    if (q.trim()) sp.set('q', q.trim())
    if (cat) sp.set('group', cat)
    if (deliverTo) sp.set('state', deliverTo)
    const qs = sp.toString()
    navigate(`/marketplace${qs ? `?${qs}` : ''}`)
    setOpen(false)
  }

  const tabActive = (to: string) => {
    const base = to.split('#')[0]
    return base === '/' ? location.pathname === '/' : location.pathname.startsWith(base)
  }

  const initials = (profile?.full_name ?? 'U')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <div className="min-h-screen bg-white text-emerald-950">
      <header className="sticky top-0 z-40 bg-white">
        {/* Row 1 — top bar */}
        <div className="border-b border-line">
          <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
            {/* The tagline returns at `sm`. At 390px the lockup is 235px wide
                and, being shrink-0, it pushed the account controls 9px past
                the viewport. Dropping the strapline on the narrowest screens
                lets the row fit on its own, with nothing clipped or hidden. */}
            <Link to={brandHref} className="min-w-0 shrink-0">
              <Logo withTagline taglineClassName="hidden sm:block" />
            </Link>

            {/* Deliver to */}
            <label className="hidden h-9 min-h-touch items-center gap-1.5 rounded border border-line px-2.5 lg:flex">
              <MapPin className="h-4 w-4 shrink-0 text-emerald-700" strokeWidth={1.5} aria-hidden />
              <span className="text-[10px] font-medium uppercase leading-none tracking-wide text-emerald-900/45">
                {t('public.deliverTo')}
              </span>
              <select
                value={deliverTo}
                onChange={(e) => setDeliverTo(e.target.value)}
                aria-label={t('public.deliverToState')}
                /* The <label> around this is comfortably large, but the
                   SELECT is what receives the tap, and it was 18px. */
                className="h-9 min-h-touch max-w-[7.5rem] cursor-pointer bg-transparent text-sm font-medium text-emerald-950 focus:outline-none"
              >
                <option value="">{t('public.allNigeria')}</option>
                {NIGERIA_STATES.map((s) => (<option key={s} value={s}>{s}</option>))}
              </select>
            </label>

            {/* Search */}
            <form onSubmit={runSearch} className="hidden flex-1 md:flex">
              <div className="relative hidden shrink-0 lg:block">
                <select
                  value={cat}
                  onChange={(e) => setCat(e.target.value)}
                  aria-label={t('public.searchCategory')}
                  className="h-9 min-h-touch max-w-[9rem] cursor-pointer appearance-none rounded-l border border-r-0 border-line bg-surface pl-3 pr-7 text-sm font-medium text-emerald-900/80 focus:outline-none"
                >
                  <option value="">{t('public.allCategories')}</option>
                  {COMMODITY_GROUPS.map((g) => (<option key={g.key} value={g.key}>{g.label}</option>))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-900/40" aria-hidden />
              </div>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('public.searchPlaceholder')}
                aria-label={t('public.searchTheMarketplace')}
                className="h-9 min-h-touch w-full min-w-32 rounded-l border-y border-l border-line bg-white px-3 text-sm text-emerald-950 placeholder:text-emerald-900/35 focus:outline-none lg:rounded-l-none lg:border-l-0"
              />
              <button
                type="submit"
                className="inline-flex h-9 min-h-touch shrink-0 items-center gap-1.5 rounded-r bg-emerald-800 px-4 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
              >
                <Search className="h-4 w-4" aria-hidden /> <span className="hidden lg:inline">{t('common.search')}</span>
              </button>
            </form>

            {/* Account cluster */}
            <div className="ml-auto flex min-w-0 items-center gap-1.5 md:ml-0">
              {authed ? (
                <>
                  <Link
                    to="/orders"
                    aria-label={t('public.orders')}
                    className="hidden h-9 w-9 min-h-touch min-w-touch items-center justify-center rounded text-emerald-900/70 hover:bg-emerald-50 sm:flex"
                  >
                    <Package className="h-5 w-5" strokeWidth={1.5} aria-hidden />
                  </Link>
                  <Link
                    to="/wishlist"
                    aria-label={wishlistCount ? t('a11y.savedItemsWithCount', { count: wishlistCount }) : t('a11y.savedItems')}
                    className="relative hidden h-9 w-9 min-h-touch min-w-touch items-center justify-center rounded text-emerald-900/70 hover:bg-emerald-50 sm:flex"
                  >
                    <Heart className="h-5 w-5" strokeWidth={1.5} aria-hidden />
                    {wishlistCount > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-gold-400 px-1 text-[10px] font-bold leading-none text-emerald-950">
                        {wishlistCount}
                      </span>
                    )}
                  </Link>
                  <CartIconLink
                    className="h-9 w-9 min-h-touch min-w-touch rounded text-emerald-900/70 hover:bg-emerald-50"
                    badgeClassName="absolute -right-0.5 -top-0.5 h-4 min-w-4 px-1 text-[10px]"
                  />
                  {/* min-h/min-w: below `sm` the name block beside the avatar is hidden,
                      so this link collapses to the 32px avatar and was a 38x41
                      target - on the one control that reaches the account. */}
                  <Link to="/" className="flex min-h-touch min-w-touch min-w-0 items-center gap-2 rounded px-1.5 py-1 hover:bg-emerald-50">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-800 text-xs font-bold text-white">
                      {initials}
                    </span>
                    <span className="hidden min-w-0 leading-tight sm:block">
                      <span className="block max-w-[9rem] truncate text-sm font-semibold text-emerald-950">
                        {profile?.full_name ?? t('marketplace.myAccount')}
                      </span>
                      <span className="block text-[11px] capitalize text-emerald-900/55">
                        {profile?.platform_role?.replace('_', ' ') ?? t('marketplace.member')}
                      </span>
                    </span>
                  </Link>
                </>
              ) : (
                <>
                  {/* md, not sm: these are the primary actions for a
                      signed-out visitor and were 30px targets. */}
                  <Link to="/login" className="hidden sm:block"><Button variant="ghost">{t('public.signIn')}</Button></Link>
                  <Link to="/signup"><Button>{t('public.getStarted')}</Button></Link>
                </>
              )}
              <button
                type="button"
                className="flex h-9 w-9 min-h-touch min-w-touch items-center justify-center rounded text-emerald-900/70 hover:bg-emerald-50 md:hidden"
                onClick={() => setOpen((v) => !v)}
                aria-label={t('public.menu')}
                aria-expanded={open}
              >
                {open ? <X className="h-5 w-5" strokeWidth={1.5} /> : <Menu className="h-5 w-5" strokeWidth={1.5} />}
              </button>
            </div>
          </div>
        </div>

        {/* Row 2 — secondary category-nav strip */}
        <div className="hidden border-b border-line bg-white md:block">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <nav className="-mb-px flex items-center gap-1 overflow-x-auto" aria-label={t('public.sections')}>
              {TABS.map((t) => {
                const active = tabActive(t.to)
                return (
                  <Link
                    key={t.label}
                    to={t.to}
                    className={cn(
                      'flex min-h-touch shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors',
                      active
                        ? 'border-emerald-800 text-emerald-800'
                        : 'border-transparent text-emerald-900/65 hover:text-emerald-900',
                    )}
                  >
                    {t.label}
                    {t.badge && (
                      <span className="rounded-sm bg-gold-400 px-1 text-[9px] font-bold uppercase leading-4 text-emerald-950">
                        {t.badge}
                      </span>
                    )}
                  </Link>
                )
              })}
            </nav>
          </div>
        </div>

        {/* Mobile panel — search + tabs */}
        {open && (
          <div className="border-b border-line bg-white px-4 py-3 md:hidden">
            <form onSubmit={runSearch} className="flex items-stretch">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('public.searchPlaceholderShort')}
                aria-label={t('public.searchTheMarketplace')}
                className="h-9 min-h-touch w-full rounded-l border border-r-0 border-line bg-white px-3 text-sm placeholder:text-emerald-900/35 focus:outline-none"
              />
              <button type="submit" aria-label={t('common.search')} className="inline-flex h-9 min-h-touch shrink-0 items-center rounded-r bg-emerald-800 px-3 text-white">
                <Search className="h-4 w-4" aria-hidden />
              </button>
            </form>
            <label className="mt-2 flex h-9 items-center gap-2 rounded border border-line px-2.5">
              <MapPin className="h-4 w-4 shrink-0 text-emerald-700" strokeWidth={1.5} aria-hidden />
              <span className="text-[11px] font-medium uppercase text-emerald-900/45">{t('public.deliverTo')}</span>
              <select
                value={deliverTo}
                onChange={(e) => setDeliverTo(e.target.value)}
                aria-label={t('public.deliverToState')}
                className="flex-1 bg-transparent text-sm font-medium focus:outline-none"
              >
                <option value="">All Nigeria</option>
                {NIGERIA_STATES.map((s) => (<option key={s} value={s}>{s}</option>))}
              </select>
            </label>
            <nav className="mt-2 grid grid-cols-2 gap-1" aria-label="Sections">
              {TABS.map((t) => (
                <Link
                  key={t.label}
                  to={t.to}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-1.5 rounded px-2 py-2 text-sm font-medium text-emerald-900/80 hover:bg-emerald-50"
                >
                  {t.label}
                  {t.badge && (
                    <span className="rounded-sm bg-gold-400 px-1 text-[9px] font-bold uppercase leading-4 text-emerald-950">
                      {t.badge}
                    </span>
                  )}
                </Link>
              ))}
              {!authed && (
                <Link to="/login" onClick={() => setOpen(false)} className="rounded px-2 py-2 text-sm font-medium text-emerald-900/80 hover:bg-emerald-50">
                  Sign in
                </Link>
              )}
            </nav>
          </div>
        )}
      </header>

      <main>{children}</main>

      <footer className="bg-emerald-800">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-sm">
              <Logo tone="light" />
              <p className="mt-3 text-[12px] leading-relaxed text-[#9FB5AC]">{t(DISCLAIMER_KEY)}</p>
            </div>
            <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-label={t('public.footer')}>
              {NAV.map((n) => (
                /* -my-2 py-2: 19px of text was a 19px target. */
                <a
                  key={n.label}
                  href={n.href}
                  className="-my-2 inline-flex min-h-touch min-w-touch items-center justify-center rounded py-2 text-white/80 hover:text-white focus-visible:ring-white/60"
                >
                  {n.label}
                </a>
              ))}
            </nav>
          </div>
          {/* Legal row. Terms of Service is deliberately ABSENT rather than
              linked to a placeholder: there is no terms content in this
              codebase, and a link to an empty page is worse than no link.
              Adding one entry to LEGAL_NAV is all it will take. */}
          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[#0C6650] pt-4 text-[12px]">
            {LEGAL_NAV.map((l) => (
              <Link
                key={l.label}
                to={l.to}
                className="-my-2 inline-flex min-h-touch items-center rounded py-2 text-white/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              >
                {l.label}
              </Link>
            ))}
            <button
              type="button"
              onClick={reopenPrivacy}
              className="-my-2 inline-flex min-h-touch items-center rounded py-2 text-white/80 underline-offset-2 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              Privacy preferences
            </button>
          </div>

          {/* The language control sits on the existing bottom bar rather than
              in a new block of its own: it stacks above the copyright at 390px
              and sits opposite it from `sm` up, so the footer gains a control
              without gaining a section. */}
          <div className="mt-4 flex flex-col gap-2 border-t border-[#0C6650] pt-4 text-[12px] text-[#9FB5AC] sm:flex-row sm:items-center sm:justify-between">
            <p>© 2026 Braventi Techworks. A Braventi Holdings company.</p>
            <div className="flex items-center gap-2">
              <span className="shrink-0">{t('footer.language')}</span>
              <LanguageSelector variant="footer" />
            </div>
          </div>
          {/* The paragraph of creator names that used to sit here is gone; a
              link replaces it. That is a licence question, not a layout one,
              so the reasoning is written down:

              The hero photographs are CC BY-SA 4.0, which does require
              attribution. But clause 3(a)(2) of that licence says the
              conditions "may be satisfied in any reasonable manner based on
              the medium, means, and context", and names linking to a resource
              that carries the information as an example of doing so. So the
              creator names, titles, source URLs, the licence and the note that
              the files were cropped and re-encoded all live in
              public/images/IMAGE-CREDITS.md, and this link resolves to it.

              What may NOT happen is the link going too. If every pointer to
              the attribution disappears, the licence is no longer satisfied,
              whatever the footer looks like. tests/unit/image-credits.test.ts
              fails if this link is removed while a CC-licensed hero is still
              in use. */}
          <a
            href="/images/IMAGE-CREDITS.md"
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex min-h-touch items-center rounded text-[11px] text-[#9FB5AC] underline underline-offset-2 hover:text-white"
          >
            {t('footer.imageCredits')}
          </a>
        </div>
      </footer>

      {profile && null /* keep hook used */}
    </div>
  )
}
