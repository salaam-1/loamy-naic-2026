import { BadgeCheck, Landmark, Mail, Phone, ShieldCheck, Truck } from 'lucide-react'
import { DashboardCard } from '@/components/DashboardCard'
import { useT } from '@/lib/i18n'
import { BANK_RAILS_COPY } from '@/lib/marketplace'

/**
 * Honest replacements for the mockup's "Deals of the Day", "Why Choose Loamy"
 * and bottom trust bar. Every claim here is true of how Loamy actually works:
 * no escrow (Loamy never holds funds — deals settle on bank rails), no invented
 * discounts, countdowns or statistics.
 */

const REASONS = [
  { icon: BadgeCheck, titleKey: 'marketplace.trust.verifiedBuyersSellers', bodyKey: 'marketplace.trust.verifiedBuyersSellersBody' },
  // The settlement line says the money never passes through Loamy. That is a
  // claim about the product, not a slogan, and the pack note says so.
  { icon: Landmark, titleKey: 'marketplace.trust.bankRails', bodyKey: 'marketplace.trust.bankRailsBody' },
  { icon: ShieldCheck, titleKey: 'marketplace.trust.fieldVerified', bodyKey: 'marketplace.trust.growthPartnersVerify' },
  { icon: Truck, titleKey: 'marketplace.trust.storageLogisticsTitle', bodyKey: 'marketplace.trust.storageLogisticsBody' },
]

/** Right-rail card that stands in for the mockup's "Deals of the Day" promo. */
export function TradingInsightCard() {
  const { t } = useT()
  return (
    <DashboardCard title={t('marketplace.howTradingWorks')}>
      <ol className="space-y-2 text-sm text-emerald-900/75">
        <li className="flex gap-2"><span className="font-mono text-xs font-semibold text-emerald-800">1</span> {t('marketplace.step.findListing')}</li>
        <li className="flex gap-2"><span className="font-mono text-xs font-semibold text-emerald-800">2</span> {t('marketplace.step.sellerAccepts')}</li>
        <li className="flex gap-2"><span className="font-mono text-xs font-semibold text-emerald-800">3</span> {t('marketplace.step.settleDirectly')}</li>
      </ol>
      <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-emerald-900/55">{BANK_RAILS_COPY}</p>
    </DashboardCard>
  )
}

/** "Why choose Loamy?" band — honest, on-brand, flat. */
export function WhyLoamy() {
  const { t } = useT()
  return (
    <section className="rounded border border-line bg-white p-5 sm:p-6">
      <h3 className="text-base font-bold text-emerald-950">{t('marketplace.whyChooseLoamy')}</h3>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {REASONS.map(({ icon: Icon, titleKey, bodyKey }) => (
          <div key={titleKey} className="flex gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-emerald-50">
              <Icon className="h-5 w-5 text-emerald-800" strokeWidth={1.5} aria-hidden />
            </span>
            <div>
              <p className="text-sm font-semibold text-emerald-950">{t(titleKey)}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-emerald-900/60">{t(bodyKey)}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Community / contact — real channels, no invented social following. */}
      <div className="mt-5 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-emerald-900/70">{t('marketplace.questionsHelp')}</p>
        <div className="flex flex-wrap gap-4 text-sm">
          <a href="mailto:support@loamy.ng" className="flex items-center gap-1.5 font-medium text-emerald-800 hover:text-emerald-700">
            <Mail className="h-4 w-4" strokeWidth={1.5} aria-hidden /> support@loamy.ng
          </a>
          <a href="tel:+2347042768655" className="flex items-center gap-1.5 font-mono font-medium text-emerald-800 hover:text-emerald-700">
            <Phone className="h-4 w-4" strokeWidth={1.5} aria-hidden /> +234 704 276 8655
          </a>
        </div>
      </div>
    </section>
  )
}

const TRUST = [
  { icon: ShieldCheck, titleKey: 'marketplace.trust.verifiedSellers', subKey: 'marketplace.trust.identityChecked' },
  { icon: Landmark, titleKey: 'marketplace.trust.bankRails', subKey: 'marketplace.trust.loamyHoldsNoFunds' },
  { icon: BadgeCheck, titleKey: 'marketplace.trust.fieldVerified', subKey: 'marketplace.trust.checkedOnGround' },
  { icon: Truck, titleKey: 'marketplace.trust.logisticsDirectory', subKey: 'marketplace.trust.storageTransport' },
]

/** Flat bottom trust strip. */
export function TrustBar() {
  const { t } = useT()
  return (
    <section className="grid gap-px overflow-hidden rounded border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
      {TRUST.map(({ icon: Icon, titleKey, subKey }) => (
        <div key={titleKey} className="flex items-center gap-3 bg-white p-4">
          <Icon className="h-6 w-6 shrink-0 text-emerald-800" strokeWidth={1.5} aria-hidden />
          <div>
            <p className="text-sm font-semibold text-emerald-950">{t(titleKey)}</p>
            <p className="text-xs text-emerald-900/55">{t(subKey)}</p>
          </div>
        </div>
      ))}
    </section>
  )
}
