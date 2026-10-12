import type { ComponentType } from 'react'
import GrowthPartnerOverview from '@/pages/partner/GrowthPartnerOverview'
import OnboardFarmer from '@/pages/partner/OnboardFarmer'
import MyFarmers from '@/pages/partner/MyFarmers'
import VerificationTasks from '@/pages/partner/VerificationTasks'
import Earnings from '@/pages/partner/Earnings'
import AmbassadorPrices from '@/pages/partner/AmbassadorPrices'
import InspectionQueue from '@/pages/partner/InspectionQueue'

/** Growth Partner sections rendered by RoleDashboard inside the AppShell. */
export const PARTNER_SECTIONS: Record<string, ComponentType> = {
  onboard: OnboardFarmer,
  'my-farmers': MyFarmers,
  'verification-tasks': VerificationTasks,
  'price-updates': AmbassadorPrices,
  inspections: InspectionQueue,
  earnings: Earnings,
}
