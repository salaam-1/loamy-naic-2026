import { useCallback, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { CartProvider } from '@/context/CartContext'
import { LanguageProvider } from '@/lib/i18n'
import { saveLanguagePreference } from '@/lib/userLanguage'
import type { Locale } from '@/lib/i18n/types'
import { isSupabaseConfigured } from '@/lib/supabase'
import { EnvNotice } from '@/components/EnvNotice'
import { HomeRedirect, PublicOnly, RequireAdmin, RequireAuth, RequireBank } from '@/routes/guards'
import Landing from '@/pages/public/Landing'
import PublicMarketplace from '@/pages/public/PublicMarketplace'
import PublicListingDetail from '@/pages/public/PublicListingDetail'
import Suppliers from '@/pages/public/Suppliers'
import SupplierStorefront from '@/pages/public/SupplierStorefront'
import BuyRequests from '@/pages/public/BuyRequests'
import Insights from '@/pages/public/Insights'
import PublicProfile from '@/pages/public/PublicProfile'
import TraceExplorer from '@/pages/trace/TraceExplorer'
import Privacy from '@/pages/public/Privacy'
import { PrivacyNotice } from '@/components/PrivacyNotice'
import Discover from '@/pages/marketplace/Discover'
import BuyerFinancingApply from '@/pages/marketplace/FinancingApply'
import PurchaseDetail from '@/pages/marketplace/PurchaseDetail'
import CartPage from '@/pages/marketplace/CartPage'
import CheckoutPage from '@/pages/marketplace/CheckoutPage'
import OrdersPage from '@/pages/marketplace/OrdersPage'
import WishlistPage from '@/pages/marketplace/WishlistPage'
import Login from '@/pages/auth/Login'
import Signup from '@/pages/auth/Signup'
import ForgotPassword from '@/pages/auth/ForgotPassword'
import ResetPassword from '@/pages/auth/ResetPassword'
import Onboarding from '@/pages/Onboarding'
import RoleDashboard from '@/pages/RoleDashboard'
import FarmForm from '@/pages/farmer/FarmForm'
import FarmDetail from '@/pages/farmer/FarmDetail'
import FinancingApply from '@/pages/farmer/FinancingApply'
import ListingDetail from '@/pages/marketplace/ListingDetail'
import ListingForm from '@/pages/marketplace/ListingForm'
import TaskDetail from '@/pages/partner/TaskDetail'
import FieldOps from '@/pages/partner/FieldOps'
import BankHome from '@/pages/bank/BankHome'
import BankPipeline from '@/pages/bank/BankPipeline'
import BankApplicationDetail from '@/pages/bank/BankApplicationDetail'
import BankReports from '@/pages/bank/BankReports'
import BankMonitoring from '@/pages/bank/BankMonitoring'
import BankLoans from '@/pages/bank/BankLoans'
import BankFacilityDetail from '@/pages/bank/BankFacilityDetail'
import BankCustomers from '@/pages/bank/BankCustomers'
import BankCollateral from '@/pages/bank/BankCollateral'
import BankDisbursements from '@/pages/bank/BankDisbursements'
import BankRepayments from '@/pages/bank/BankRepayments'
import BankTransactions from '@/pages/bank/BankTransactions'
import BankRiskCompliance from '@/pages/bank/BankRiskCompliance'
import BankAlerts from '@/pages/bank/BankAlerts'
import BankMessages from '@/pages/bank/BankMessages'
import BankSettings from '@/pages/bank/BankSettings'
import ReportView from '@/pages/bank/ReportView'
import Admin from '@/pages/Admin'
import NotFound from '@/pages/NotFound'

function AdminSectionRoute() {
  const { adminSection } = useParams()
  return <Admin section={adminSection} />
}

/**
 * `/` is the public marketplace storefront; signed-in users route to their
 * dashboard. The original marketing page is preserved at /welcome.
 *
 * `preview` is what makes the homepage a shop window rather than the shop: it
 * bounds the listing read and renders a link onward to /marketplace, which is
 * the same component without the bound.
 */
function PublicHome() {
  const { loading, session } = useAuth()
  if (!loading && session) return <HomeRedirect />
  return <PublicMarketplace preview />
}

/**
 * Connects the saved account preference to the language provider.
 *
 * `explicitLocale` is null for a member who has never chosen, which is what
 * makes the resolution order work: null means fall through to the device
 * choice, then the browser, then English. A browser language is never written
 * into an account.
 *
 * `onLocaleChange` returns a promise ONLY when there is an account to write to.
 * For an anonymous visitor it returns undefined, so the provider reports 'idle'
 * rather than 'saved' — nothing was saved, and Settings must not claim it was.
 */
function AppLanguage({ children }: { children: ReactNode }) {
  const { languagePreference, session } = useAuth()
  const onLocaleChange = useCallback(
    (next: Locale) => (session ? saveLanguagePreference(next) : undefined),
    [session],
  )
  return (
    <LanguageProvider explicitLocale={languagePreference} onLocaleChange={onLocaleChange}>
      {children}
    </LanguageProvider>
  )
}

export default function App() {
  if (!isSupabaseConfigured) return <EnvNotice />

  return (
    <BrowserRouter>
      <AuthProvider>
        {/* Language sits inside Auth so it can read the signed-in member's
            saved preference, and outside everything that renders copy. A
            change re-renders the tree; it never reloads the page. */}
        <AppLanguage>
        <CartProvider>
        <Routes>
          {/* Public marketplace storefront is the landing (/ and /marketplace).
              The original marketing page lives at /welcome. */}
          <Route path="/" element={<PublicHome />} />
          <Route path="/welcome" element={<Landing />} />
          <Route path="/marketplace" element={<PublicMarketplace />} />
          <Route path="/marketplace/:id" element={<PublicListingDetail />} />
          <Route path="/suppliers" element={<Suppliers />} />
          <Route path="/suppliers/:id" element={<SupplierStorefront />} />
          <Route path="/buy-requests" element={<BuyRequests />} />
          <Route path="/insights" element={<Insights />} />
          {/* Public by design: someone deciding whether to sign up has to be
              able to read the policy before they do. */}
          <Route path="/privacy" element={<Privacy />} />

          {/* Block 1 — public identity. Visibility is enforced server-side by
              loamy_profile_by_username, so this route is open. */}
          <Route path="/u/:username" element={<PublicProfile />} />

          {/* Block 3 — discovery. Signed-in: ranking reads the caller's own
              behaviour, so there is no anonymous form of it. */}
          <Route path="/discover" element={<RequireAuth><Discover /></RequireAuth>} />

          {/* Block 4 — the buyer financing golden path. Both are party-scoped
              server-side; the routes simply require a session. */}
          <Route path="/purchase/:txnId" element={<RequireAuth><PurchaseDetail /></RequireAuth>} />
          <Route path="/financing/apply/:txnId" element={<RequireAuth><BuyerFinancingApply /></RequireAuth>} />

          {/* Block 2 — Trace Explorer. Signed-in: loamy_trace refuses anon. */}
          <Route path="/trace" element={<RequireAuth><TraceExplorer /></RequireAuth>} />
          <Route path="/trace/:ref" element={<RequireAuth><TraceExplorer /></RequireAuth>} />
          <Route path="/cart" element={<RequireAuth><CartPage /></RequireAuth>} />
          <Route path="/checkout" element={<RequireAuth><CheckoutPage /></RequireAuth>} />
          <Route path="/orders" element={<RequireAuth><OrdersPage /></RequireAuth>} />
          <Route path="/wishlist" element={<RequireAuth><WishlistPage /></RequireAuth>} />

          <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
          <Route path="/signup" element={<PublicOnly><Signup /></PublicOnly>} />
          <Route path="/forgot-password" element={<PublicOnly><ForgotPassword /></PublicOnly>} />
          {/* Not PublicOnly: the recovery link signs the user in, then they set a password here. */}
          <Route path="/reset-password" element={<ResetPassword />} />

          <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />

          {/* Farmer deep routes (Stage 2) — declared before the generic role routes. */}
          <Route path="/dashboard/farmer/my-farm/new" element={<RequireAuth><FarmForm /></RequireAuth>} />
          <Route path="/dashboard/farmer/my-farm/:farmId" element={<RequireAuth><FarmDetail /></RequireAuth>} />
          <Route path="/dashboard/farmer/my-farm/:farmId/edit" element={<RequireAuth><FarmForm /></RequireAuth>} />
          <Route path="/dashboard/farmer/financing/apply" element={<RequireAuth><FinancingApply /></RequireAuth>} />

          {/* Marketplace deep routes (Stage 3) — any trading role, guarded inside. */}
          <Route path="/dashboard/:role/marketplace/listing/:listingId" element={<RequireAuth><ListingDetail /></RequireAuth>} />
          <Route path="/dashboard/:role/my-listings/new" element={<RequireAuth><ListingForm /></RequireAuth>} />
          <Route path="/dashboard/:role/my-listings/:listingId/edit" element={<RequireAuth><ListingForm /></RequireAuth>} />

          {/* Field verification deep route (Stage 4) — mobile-first evidence capture. */}
          <Route path="/dashboard/growth_partner/verification-tasks/:taskId" element={<RequireAuth><TaskDetail /></RequireAuth>} />
          {/* Block 5 — the Growth Partner operational board. */}
          <Route path="/dashboard/growth_partner/field-ops" element={<RequireAuth><FieldOps /></RequireAuth>} />

          <Route path="/dashboard/:role" element={<RequireAuth><RoleDashboard /></RequireAuth>} />
          <Route path="/dashboard/:role/:section" element={<RequireAuth><RoleDashboard /></RequireAuth>} />

          {/* Bank portal (Stage 5) — admin-created officers only; no approve/decline exists. */}
          <Route path="/bank" element={<RequireBank><BankHome /></RequireBank>} />
          <Route path="/bank/pipeline" element={<RequireBank><BankPipeline /></RequireBank>} />
          <Route path="/bank/application/:appId" element={<RequireBank><BankApplicationDetail /></RequireBank>} />
          <Route path="/bank/loans" element={<RequireBank><BankLoans /></RequireBank>} />
          <Route path="/bank/loans/:facilityId" element={<RequireBank><BankFacilityDetail /></RequireBank>} />
          <Route path="/bank/customers" element={<RequireBank><BankCustomers /></RequireBank>} />
          <Route path="/bank/collateral" element={<RequireBank><BankCollateral /></RequireBank>} />
          <Route path="/bank/disbursements" element={<RequireBank><BankDisbursements /></RequireBank>} />
          <Route path="/bank/repayments" element={<RequireBank><BankRepayments /></RequireBank>} />
          <Route path="/bank/transactions" element={<RequireBank><BankTransactions /></RequireBank>} />
          <Route path="/bank/risk" element={<RequireBank><BankRiskCompliance /></RequireBank>} />
          <Route path="/bank/alerts" element={<RequireBank><BankAlerts /></RequireBank>} />
          <Route path="/bank/messages" element={<RequireBank><BankMessages /></RequireBank>} />
          <Route path="/bank/settings" element={<RequireBank><BankSettings /></RequireBank>} />
          <Route path="/bank/reports" element={<RequireBank><BankReports /></RequireBank>} />
          <Route path="/bank/reports/:reportId" element={<RequireBank><ReportView /></RequireBank>} />
          <Route path="/bank/monitoring" element={<RequireBank><BankMonitoring /></RequireBank>} />

          <Route path="/admin" element={<RequireAdmin><Admin /></RequireAdmin>} />
          <Route path="/admin/:adminSection" element={<RequireAdmin><AdminSectionRoute /></RequireAdmin>} />

          <Route path="/404" element={<NotFound />} />
          <Route path="*" element={<Navigate to="/404" replace />} />
        </Routes>
        {/* Outside <Routes> so the notice survives navigation and is not
            remounted (and re-animated) on every route change. */}
        <PrivacyNotice />
        </CartProvider>
        </AppLanguage>
      </AuthProvider>
    </BrowserRouter>
  )
}
