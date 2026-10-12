import type { TranslationPack } from '../en'
import { haCore } from './core'
import { haDomain } from './domain'
import { bank as haBank } from './bank'
import { haOperations } from './operations'
import { processor as haProcessor } from './processor'
import { haPublic } from './publicSite'

/**
 * Hausa (Boko).
 *
 * Status: partial and deliberately so. The confident core is translated and the
 * remainder falls back to English. See glossary.md for what a reviewer should
 * challenge first.
 *
 * `operations` is a separate file because its gaps are a decision rather than a
 * backlog: the status words and labels are translated, and the long compliance
 * paragraphs are left in English until a reviewer with financial-services
 * Hausa has been through them. That file says which, and why.
 */
export const ha: TranslationPack = { ...haCore, ...haDomain, ...haOperations,
  ...haProcessor, ...haBank, ...haPublic }
