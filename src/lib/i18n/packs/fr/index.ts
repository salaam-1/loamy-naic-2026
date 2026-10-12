import type { TranslationPack } from '../en'
import { bank as frBank } from './bank'
import { frCore } from './core'
import { frDomain } from './domain'
import { frFarm } from './farm'
import { frOperations } from './operations'
import { processor as frProcessor } from './processor'
import { frPublic } from './publicSite'

/**
 * French.
 *
 * Split into `core` (chrome: actions, nav, auth, settings, footer, a11y,
 * terminology, roles) and `domain` (trading, money, operations) rather than one
 * file per English namespace. A translator works through a language in passes
 * of related meaning, not in the order the engineering happened to group it.
 *
 * `operations` is split out because that vocabulary carries rules the
 * rest does not: every sentence must keep the bank as the actor, and the
 * contract and identifier names (Murabaha, BVN, NIN) do not translate.
 *
 * Status: translated, NOT reviewed by a native speaker. See glossary.md.
 */
export const fr: TranslationPack = { ...frCore, ...frDomain, ...frFarm,
  ...frOperations, ...frProcessor, ...frBank, ...frPublic }
