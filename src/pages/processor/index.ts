import type { ComponentType } from 'react'
import ProcessorOverview from '@/pages/processor/ProcessorOverview'
import Analytics from '@/pages/processor/Analytics'
import CompanyHub from '@/pages/processor/CompanyHub'
import CompanyTeam from '@/pages/processor/CompanyTeam'
import BuyRequests from '@/pages/processor/BuyRequests'
import Contracts from '@/pages/processor/Contracts'
import Inspections from '@/pages/processor/Inspections'
import Logistics from '@/pages/processor/Logistics'

/**
 * Processor / Large-Offtaker sections rendered by RoleDashboard inside the
 * AppShell. Part 1 ships Company + Team; the procurement suite (RFQs, bids,
 * awards, contracts, inspections, payments, logistics, analytics) arrives in
 * Parts 2–9 behind the `processor_procurement` flag.
 */
export const PROCESSOR_SECTIONS: Record<string, ComponentType> = {
  overview: ProcessorOverview,
  analytics: Analytics,
  company: CompanyHub,
  team: CompanyTeam,
  rfqs: BuyRequests,
  contracts: Contracts,
  inspections: Inspections,
  logistics: Logistics,
}
