import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, Heart, LogOut, Menu, Package, Settings, X } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { CartIconLink } from '@/components/CartIconLink'
import { Copilot } from '@/components/copilot/Copilot'
import { NotificationsBell } from '@/components/layout/NotificationsBell'
import { RoleSwitcher } from '@/components/layout/RoleSwitcher'
import { useAuth } from '@/context/AuthContext'
import { useCart } from '@/context/CartContext'
import { useT } from '@/lib/i18n'
import { MARKETPLACE_ROLES } from '@/lib/marketplace'
import { TAB_META, groupNav, tabFor, tabLanding, type PrimaryTab } from '@/lib/navigation'
import type { NavItem } from '@/lib/roles'
import { cn, firstName, initials } from '@/lib/utils'

interface AppShellProps {
  nav: NavItem[]
  activeSection: string
  /** Builds an href for a nav item's section segment. */
  sectionHref: (section: string) => string
  roleLabel: string
  /**
   * The page's H1, when the shell should own it.
   *
   * Measured before adding this: bank and admin pages had NO h1 and started at
   * h3, skipping two levels, and settings started at h2. Only the member
   * overview had an h1, because HomeHero renders one.
   *
   * It is opt-in rather than derived so that a page which already renders its
   * own h1 does not end up with two, which is the duplicate-hierarchy problem
   * this is meant to remove, not create.
   */
  pageTitle?: string
  /** Optional live counts shown as a pill on the matching nav item. */
  badges?: Record<string, number>
  children: ReactNode
}

/**
 * Dashboard chrome.
 *
 * TWO SHAPES, ONE NAVIGATION MODEL
 *   Desktop keeps a sidebar, but the flat list is now GROUPED into the five
 *   primary jobs (see src/lib/navigation.ts) so a role with fifteen sections
 *   reads as five decisions rather than fifteen.
 *
 *   Phones get a bottom tab bar, because a thumb reaches the bottom of a
 *   screen and not a hamburger in the top-left corner. Tapping a tab with one
 *   section goes straight there; a tab with several opens a sheet listing
 *   them. That is why the tab bar is five items and not fifteen.
 *
 *   Both read the SAME grouped structure. There is no separate mobile nav to
 *   fall out of sync.
 *
 * WHAT DID NOT CHANGE
 *   Flag and capability filtering happen before grouping, exactly as before,
 *   so a section someone may not see is still not shown. Section keys,
 *   routes and badges are untouched.
 */
export function AppShell({ nav, activeSection, sectionHref, roleLabel, pageTitle, badges, children }: AppShellProps) {
  const { profile, flagEnabled, canVerify, signOut } = useAuth()
  const { t, tOr } = useT()

  /**
   * Nav labels come from src/lib/roles.ts, which still carries the English as
   * data. Translate by section slug, and if the pack has no entry fall back to
   * that English rather than to the key name: a member must never see
   * "nav.my-fleet" because a translation is outstanding.
   *
   * `tOr` is that rule, shared with every other surface whose vocabulary
   * lives in a lib map. This was a local copy until the third one appeared.
   */
  const label = tOr
  const { cartCount, wishlistCount } = useCart()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [sheetTab, setSheetTab] = useState<PrimaryTab | null>(null)
  const [accountOpen, setAccountOpen] = useState(false)
  const navigate = useNavigate()

  const canShop = !!profile?.platform_role && (MARKETPLACE_ROLES as string[]).includes(profile.platform_role)

  const visibleNav = useMemo(
    () => nav.filter((item) => flagEnabled(item.flag) && (item.capability !== 'can_verify' || canVerify)),
    [nav, flagEnabled, canVerify],
  )
  const groups = useMemo(() => groupNav(visibleNav), [visibleNav])
  /**
   * Where the brand lockup goes. `sectionHref('overview')` is already each
   * shell's own home: /dashboard/<role>, /bank or /admin. Reusing it keeps the
   * logo honest in all three without a new prop, and it is a router Link, so
   * clicking it does not reload the application.
   */
  const homeHref = sectionHref('overview')
  /**
   * Only the role dashboards carry a Settings section; the bank portal and the
   * admin console do not (src/lib/roles.ts is the only place it is declared).
   * Reading it off the nav that is actually rendered keeps the account menu
   * from offering a route that would 404 in those two shells.
   */
  const settingsItem = visibleNav.find((i) => i.section === 'settings')
  const activeTab = tabFor(activeSection)
  const openGroup = groups.find((g) => g.tab === sheetTab)

  /** One avatar, rendered by both the phone button and the wider chip. */
  const avatar = profile?.avatar_url ? (
    <img src={profile.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
  ) : (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-800 text-[11px] font-semibold text-white">
      {initials(profile?.full_name)}
    </span>
  )

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  /** One nav row, used by the sidebar, the drawer and the mobile sheet. */
  function navRow(item: NavItem, opts: { dark?: boolean } = {}) {
    const active = item.section === activeSection
    const Icon = item.icon
    const count = badges?.[item.section] ?? 0
    return (
      <Link
        key={item.section + item.label}
        to={item.href ?? sectionHref(item.section)}
        onClick={() => { setMobileOpen(false); setSheetTab(null) }}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex min-h-touch items-center gap-2.5 rounded-control px-2.5 py-2 text-sm font-medium transition-colors',
          opts.dark
            ? active
              ? 'bg-white/15 text-white ring-1 ring-inset ring-white/15'
              : 'text-emerald-100/70 hover:bg-white/5 hover:text-white'
            : active
              ? 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200'
              : 'text-emerald-900/75 hover:bg-sand',
        )}
      >
        <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} aria-hidden />
        <span className="flex-1 truncate">{label(`nav.${item.section}`, item.label)}</span>
        {count > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-gold-400 px-1.5 text-[10px] font-bold text-emerald-950">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </Link>
    )
  }

  const sidebar = (
    <div className="flex h-full flex-col border-r border-white/10 bg-emerald-900">
      <div className="px-5 pb-5 pt-6">
        {/* The whole lockup is the target, mark and wordmark together, rather
            than the 32px mark alone. `min-h-touch` because the lockup's own
            height is set by the artwork and the TAGLINE, so it varies by
            language: measured at 30px in English and 38.75px in Hausa, both
            under the 44px minimum. */}
        <Link
          to={homeHref}
          className="inline-flex min-h-touch items-center rounded"
          onClick={() => setMobileOpen(false)}
        >
          <Logo tone="light" withTagline />
        </Link>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label={t('a11y.mainNavigation')}>
        {groups.map((group) => (
          <div key={group.tab}>
            {/* The group heading is the only uppercase text in the shell:
                it is a divider doing a label's job, not content. */}
            <p className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-100/40">
              {label(`nav.group.${group.tab}`, group.label)}
            </p>
            <div className="space-y-0.5">{group.items.map((i) => navRow(i, { dark: true }))}</div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 p-3">
        <button
          type="button"
          onClick={handleSignOut}
          className="flex min-h-touch w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-sm font-medium text-emerald-100/70 transition-colors hover:bg-white/5 hover:text-white"
        >
          <LogOut className="h-[18px] w-[18px]" strokeWidth={1.5} aria-hidden />
          {t('common.signOut')}
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{sidebar}</aside>

      {/* Tablet drawer. Phones use the tab bar instead, so this only appears
          between the two, where a sidebar does not fit but a thumb is not the
          primary input either. */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-emerald-950/45 backdrop-blur-[2px]" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 w-72 shadow-lg">{sidebar}</aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-clay/70 bg-white/80 backdrop-blur-panel">
          <div className="flex h-14 items-center gap-2 px-4 sm:px-6">
            <button
              type="button"
              className="hidden h-10 w-10 min-h-touch min-w-touch items-center justify-center rounded-control text-emerald-900/70 transition-colors hover:bg-sand sm:flex lg:hidden"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label={t('a11y.toggleNavigation')}
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <X className="h-5 w-5" strokeWidth={1.5} /> : <Menu className="h-5 w-5" strokeWidth={1.5} />}
            </button>

            {/* Brand wherever the sidebar is not showing one. The sidebar is
                `lg` and up; the drawer that carries it between `sm` and `lg` is
                shut by default. So at tablet widths the header had no brand at
                all, which is also why there was nothing there to click. */}
            <div className="lg:hidden">
              <Link to={homeHref} className="inline-flex min-h-touch items-center rounded">
                <Logo />
              </Link>
            </div>

            <div className="hidden min-w-0 flex-1 sm:block">
              <p className="truncate text-sm font-medium text-emerald-950">
                {t('auth.welcomeBackNamed', { name: firstName(profile?.full_name) })}
              </p>
            </div>
            <div className="flex-1 sm:hidden" />

            {canShop && (
              <div className="flex items-center gap-0.5">
                <Link
                  to="/wishlist"
                  aria-label={wishlistCount ? t('a11y.savedItemsWithCount', { count: wishlistCount }) : t('a11y.savedItems')}
                  className="relative flex h-10 w-10 min-h-touch min-w-touch items-center justify-center rounded-control text-emerald-900/70 transition-colors hover:bg-sand"
                >
                  <Heart className="h-5 w-5" strokeWidth={1.5} aria-hidden />
                  {wishlistCount > 0 && (
                    <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-gold-400 px-1 text-[10px] font-bold leading-none text-emerald-950">
                      {wishlistCount > 99 ? '99+' : wishlistCount}
                    </span>
                  )}
                </Link>
                <CartIconLink
                  className="h-10 w-10 rounded-control text-emerald-900/70 transition-colors hover:bg-sand"
                  badgeClassName="absolute right-1 top-1 h-4 min-w-4 px-1 text-[10px]"
                />
                <Link
                  to="/orders"
                  aria-label={t('a11y.orders')}
                  className="hidden h-10 w-10 min-h-touch min-w-touch items-center justify-center rounded-control text-emerald-900/70 transition-colors hover:bg-sand sm:flex"
                >
                  <Package className="h-5 w-5" strokeWidth={1.5} aria-hidden />
                </Link>
              </div>
            )}

            <NotificationsBell />

            {/* ---- Account control -------------------------------------
                Sign out lives at the foot of the sidebar. The sidebar is `lg`
                only and the drawer that carries it is `sm` to `lg`, so below
                640px neither exists and there was no way to sign out of the
                shell at all: you had to find it on a profile page or switch to
                desktop mode. The phone therefore gets this menu, and `sm` and
                up keeps exactly the chip it already had. */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setAccountOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={accountOpen}
                aria-label={t('a11y.accountMenu')}
                className="flex min-h-touch min-w-touch items-center gap-2 rounded-control border border-clay bg-white/70 py-0.5 pl-0.5 pr-2 sm:hidden"
              >
                {avatar}
              </button>

              <div className="hidden items-center gap-2 rounded-control border border-clay bg-white/70 py-0.5 pl-0.5 pr-2 sm:flex">
                {avatar}
                <div className="leading-tight">
                  <span className="block max-w-36 truncate text-xs font-medium text-emerald-950">
                    {profile?.full_name ?? 'Member'}
                  </span>
                  <RoleSwitcher roleLabel={roleLabel} />
                </div>
              </div>

              {accountOpen && (
                <>
                  {/* Tapping anywhere else closes it, which is what a phone
                      user expects and what stops the menu stranding them. */}
                  <div
                    className="fixed inset-0 z-40 sm:hidden"
                    onClick={() => setAccountOpen(false)}
                    aria-hidden
                  />
                  <div
                    role="menu"
                    aria-label={t('a11y.accountMenu')}
                    className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-card border border-clay bg-white shadow-lg sm:hidden"
                  >
                    <div className="border-b border-clay px-3 py-2.5">
                      <p className="truncate text-sm font-medium text-emerald-950">
                        {profile?.full_name ?? 'Member'}
                      </p>
                      <p className="truncate text-[11px] text-emerald-900/55">{roleLabel}</p>
                    </div>
                    {settingsItem && (
                      <Link
                        to={sectionHref(settingsItem.section)}
                        role="menuitem"
                        onClick={() => setAccountOpen(false)}
                        className="flex min-h-touch w-full items-center gap-2.5 px-3 py-2.5 text-sm text-emerald-900/80 hover:bg-sand"
                      >
                        <Settings className="h-[18px] w-[18px]" strokeWidth={1.5} aria-hidden />
                        {label(`nav.${settingsItem.section}`, settingsItem.label)}
                      </Link>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAccountOpen(false)
                        void handleSignOut()
                      }}
                      className="flex min-h-touch w-full items-center gap-2.5 border-t border-clay px-3 py-2.5 text-sm font-medium text-emerald-900/80 hover:bg-sand"
                    >
                      <LogOut className="h-[18px] w-[18px]" strokeWidth={1.5} aria-hidden />
                      {t('common.signOut')}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* pb-24 on phones clears the fixed tab bar, so the last row of any
            list stays reachable instead of sitting under it. */}
        <main className="mx-auto max-w-7xl px-4 py-5 pb-24 sm:px-6 sm:py-6 lg:pb-6">
          {pageTitle && (
            /* The caller passes the nav label for this section, which is
               English held as data in roles.ts. The sidebar entry beside it
               is already translated through `label()`, so translating here
               too is what stops a French member reading a French nav item
               and an English page heading for the same page. */
            <h1 className="mb-4 text-display-sm text-emerald-950">
              {label(`nav.${activeSection}`, pageTitle)}
            </h1>
          )}
          {children}
        </main>
      </div>

      {/* ---- Mobile: bottom tab bar ---------------------------------------- */}
      <nav
        aria-label={t('a11y.primaryNavigation')}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-clay/70 bg-white/85 backdrop-blur-panel lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto flex max-w-lg items-stretch">
          {groups.map((group) => {
            const Icon = group.icon
            const active = group.tab === activeTab
            const single = group.items.length === 1
            const landing = tabLanding(group)
            const count = group.items.reduce((n, i) => n + (badges?.[i.section] ?? 0), 0)

            const inner = (
              <>
                <span className="relative">
                  <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2 : 1.5} aria-hidden />
                  {count > 0 && (
                    <span className="absolute -right-1.5 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-gold-400 px-1 text-[10px] font-bold leading-none text-emerald-950">
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                </span>
                <span className="text-[10px] font-medium leading-none">{label(`nav.group.${group.tab}`, group.label)}</span>
              </>
            )
            const className = cn(
              'flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 px-1 pt-2 transition-colors',
              active ? 'text-emerald-800' : 'text-emerald-900/50 hover:text-emerald-800',
            )

            // A tab with one destination navigates. A tab with several opens
            // a sheet — guessing which of six sections someone meant is worse
            // than asking.
            return single && landing ? (
              <Link
                key={group.tab}
                to={landing.href ?? sectionHref(landing.section)}
                className={className}
                aria-current={active ? 'page' : undefined}
              >
                {inner}
              </Link>
            ) : (
              <button
                key={group.tab}
                type="button"
                onClick={() => setSheetTab(group.tab)}
                className={className}
                aria-expanded={sheetTab === group.tab}
                aria-current={active ? 'page' : undefined}
              >
                {inner}
              </button>
            )
          })}
        </div>
      </nav>

      {/* Tab sheet */}
      {openGroup && (
        <div className="fixed inset-0 z-40 flex items-end lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-emerald-950/45 backdrop-blur-[2px]" onClick={() => setSheetTab(null)} aria-hidden />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={label(`nav.group.${openGroup.tab}`, openGroup.label)}
            className="relative z-10 max-h-[75dvh] w-full animate-slide-up overflow-y-auto rounded-t-card border-t border-clay bg-white p-4 shadow-lg"
            style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
          >
            <div className="mb-3 flex justify-center" aria-hidden>
              <span className="h-1 w-9 rounded-full bg-clay" />
            </div>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-[15px] font-semibold tracking-tight text-emerald-950">
                {label(`nav.group.${openGroup.tab}`, openGroup.label)}
              </h2>
              <p className="text-[11px] text-emerald-900/45">
                {label(`nav.group.${openGroup.tab}Description`, TAB_META[openGroup.tab].description)}
              </p>
            </div>
            <div className="space-y-0.5">
              {openGroup.items.map((item) => (
                <div key={item.section + item.label} className="flex items-center">
                  <div className="min-w-0 flex-1">{navRow(item)}</div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-emerald-900/25" aria-hidden />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <Copilot />
    </div>
  )
}
