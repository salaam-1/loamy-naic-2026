import type { ComponentType } from 'react'
import FarmerOverview from '@/pages/farmer/FarmerOverview'
import MyFarm from '@/pages/farmer/MyFarm'
import Financing from '@/pages/farmer/Financing'

/**
 * Farmer-specific sections rendered by RoleDashboard inside the AppShell.
 * Cross-role sections (marketplace, settings, notifications, …) live in
 * src/pages/shared/sections.ts.
 */
export const FARMER_SECTIONS: Record<string, ComponentType> = {
  'my-farm': MyFarm,
  financing: Financing,
}
