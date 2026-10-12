import { a11y } from './a11y'
import { account } from './account'
import { auth } from './auth'
import { bank } from './bank'
import { common } from './common'
import { copilot } from './copilot'
import { financing } from './financing'
import { footer } from './footer'
import { glossary } from './glossary'
import { farm } from './farm'
import { marketplace } from './marketplace'
import { processor } from './processor'
import { nav } from './nav'
import { operations } from './operations'
import { publicSite } from './publicSite'
import { roles } from './roles'
import { settings } from './settings'
import { transaction } from './transaction'
import { verification } from './verification'

/**
 * The canonical English pack: every key the interface can ask for.
 *
 * This object is the SINGLE source of truth for the key space. `TranslationKey`
 * is derived from it, so:
 *   - a component asking for a key that does not exist is a compile error;
 *   - every other language pack is typed as Partial<Record<TranslationKey,...>>,
 *     which makes a missing translation legal (it falls back) and a *misspelt*
 *     one impossible.
 *
 * Adding a namespace means importing it here. Nothing else changes.
 */
export const en = {
  ...common,
  ...nav,
  ...footer,
  ...auth,
  ...settings,
  ...farm,
  ...marketplace,
  ...processor,
  ...bank,
  ...financing,
  ...verification,
  ...transaction,
  ...operations,
  ...publicSite,
  ...account,
  ...roles,
  ...glossary,
  ...a11y,
  ...copilot,
} as const

export type TranslationKey = keyof typeof en

/** A pack for any non-canonical language: every key optional, none invented. */
export type TranslationPack = Partial<Record<TranslationKey, string>>

/** Namespace boundaries, used by the coverage tooling to report by area. */
export const NAMESPACES = {
  common, nav, footer, auth, settings, farm, marketplace, processor, financing, verification,
  transaction, operations, publicSite, account, roles, glossary, a11y, copilot,
} as const
