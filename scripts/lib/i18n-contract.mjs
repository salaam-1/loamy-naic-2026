/**
 * The localization contract, extracted once and shared.
 *
 * WHY THIS MODULE EXISTS
 *   Waves A.1 to A.4 each grew their own string scanner, and each one was wrong
 *   in its own way: one subtracted any value that appeared in some pack, one
 *   read only the remainder of a call's own line, one could not see a class
 *   name living in a module constant, one counted `tOr`'s English fallback as
 *   untranslated copy. Every time, the scanner was re-written inside the test
 *   that needed it, so fixing it in one place fixed it in one place.
 *
 *   So the extraction lives here, once, and both the guards in tests/unit and
 *   the reporting in scripts/i18n-*.mjs read from it. A bug in the scanner is
 *   now a bug in one file.
 *
 * THE INVARIANT IT SERVES
 *     APPLICATION SOURCE -> LOOKUP ENGINE -> CANONICAL KEY -> LOCALE PACK
 *   All four layers must agree. This module reports what each layer says; it
 *   does not decide what to do about a disagreement, which is the tests' job.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   It does not attempt real static reachability. A string behind a condition
 *   this module cannot evaluate is reported as a CANDIDATE, not as a fact, and
 *   `classify()` says which bucket it could not rule out. A false positive is
 *   preferable to a confident wrong number: the A.3 audit claimed 278 interface
 *   strings and the real figure was 547.
 *
 * Pure. No network, no database, no project imports.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const PACK_DIR = 'src/lib/i18n/packs'
export const LOCALES = ['en', 'ha', 'ig', 'yo', 'fr']

/** The suffix `pluralKey()` appends for a non-`one` plural category. */
export const PLURAL_SUFFIX = '_plural'

/**
 * Namespaces that are REFERENCE VOCABULARY rather than rendered keys.
 *
 * `term.*` is the platform's canonical terminology. Its own header says these
 * terms "appear inside hundreds of other strings", and nothing renders
 * `t('term.commodity')` directly: they exist so every pack uses the same word
 * for the same concept, and so a translator has one place to look.
 *
 * That makes them legitimately unreferenced, which is NOT the same as dead.
 * The distinction has to be explicit, because the two look identical to a
 * reachability scan and the honest treatment is opposite: a dead key should be
 * deleted (`cart.items` was, in A.5, having been superseded by
 * `a11y.addedToCartAnnouncement` back in Phase 2), while a reference term
 * should be kept and excluded from "rendered interface" counts.
 *
 * Adding a namespace here is a claim that nothing renders it on purpose. It is
 * not a way to silence a guard about a key somebody forgot to wire.
 */
export const REFERENCE_NAMESPACES = ['term.']

export function isReferenceKey(key) {
  return REFERENCE_NAMESPACES.some((p) => key.startsWith(p))
}

/** The suffixes i18next uses and this engine does not. A key ending in one of
 *  these can never be reached by `pluralKey()`. */
export const FOREIGN_PLURAL_SUFFIXES = ['_one', '_other']

// ---------------------------------------------------------------------------
// Source files
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage'])

export function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(name)) out.push(p.replace(/\\/g, '/'))
  }
  return out
}

/** Application source: everything under src EXCEPT the packs themselves.
 *  The packs are the data this contract is about, not callers of it. */
export function appSources(root = 'src') {
  return walk(root).filter((f) => !f.includes('/lib/i18n/packs/'))
}

/** Strip block comments and line comments, so prose in a doc comment is never
 *  mistaken for copy and a commented-out call is never counted as a call. */
export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

// ---------------------------------------------------------------------------
// Pack keys
// ---------------------------------------------------------------------------

/**
 * Every key a pack directory declares, with its value and the file and line it
 * came from.
 *
 * Keys may be single OR double quoted: a value containing an apostrophe reads
 * better in double quotes, and an earlier counter reported those entries as
 * missing purely because of the quoting. Both are accepted, and the two
 * counting methods must not disagree -- a coverage tool that contradicts
 * itself is the first kind of false measurement.
 */
export function packEntries(locale) {
  const dir = join(PACK_DIR, locale)
  const out = []
  let files
  try {
    files = readdirSync(dir)
  } catch {
    return out
  }
  for (const f of files.sort()) {
    if (!f.endsWith('.ts')) continue
    const raw = readFileSync(join(dir, f), 'utf8')
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    const re = /^[ \t]+(['"])([A-Za-z][\w.&+ -]*)\1\s*:\s*(['"])((?:[^\\]|\\.)*?)\3\s*,?\s*$/gm
    for (const m of src.matchAll(re)) {
      out.push({
        key: m[2],
        value: m[4].replace(/\\'/g, "'").replace(/\\"/g, '"'),
        file: `${PACK_DIR}/${locale}/${f}`,
        line: src.slice(0, m.index).split('\n').length,
      })
    }
  }
  return out
}

export function packMap(locale) {
  const out = new Map()
  for (const e of packEntries(locale)) out.set(e.key, e.value)
  return out
}

// ---------------------------------------------------------------------------
// Call sites
// ---------------------------------------------------------------------------

/**
 * The argument list of a call, from its opening paren to the matching close,
 * across however many lines it spans.
 *
 * An earlier version read only the remainder of the call's own LINE and so
 * reported every multi-line call as passing no variables at all. Ten of the
 * eighteen failures it produced were calls that do pass their vars, two lines
 * down. A guard that cries wolf gets switched off.
 */
export function balanced(text, open, openCh, closeCh) {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === openCh) depth++
    else if (text[i] === closeCh) {
      depth--
      if (depth === 0) return text.slice(open + 1, i)
    }
  }
  return ''
}

/**
 * The property names an object literal supplies, including SHORTHAND.
 * `{ email }` names `email` just as `{ email: email }` does, and the first
 * version of this missed every one of them.
 *
 * `spread` is true when the object contains a spread or a computed key, i.e.
 * when this module cannot see what is supplied and the caller must not judge.
 */
export function propertyNames(objBody) {
  const names = []
  let spread = false
  let depth = 0
  let current = ''
  const parts = []
  for (const ch of objBody) {
    if ('{[('.includes(ch)) depth++
    if ('}])'.includes(ch)) depth--
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else current += ch
  }
  parts.push(current)
  for (const part of parts) {
    const p = part.trim()
    if (!p) continue
    if (p.startsWith('...')) { spread = true; continue }
    const colon = p.indexOf(':')
    const head = (colon === -1 ? p : p.slice(0, colon)).trim()
    if (/^[A-Za-z_$][\w$]*$/.test(head)) names.push(head)
    else spread = true
  }
  return { names, spread }
}

const KEY_SHAPE = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_&+ -]+)+$/

/**
 * Every translator call the application makes, with a literal key.
 *
 * `fn` is t | tOr | tPlural. `vars` is the property names the call supplies,
 * or null when the call passes no object. `judgeable` is false when a spread
 * or computed key means this module cannot see what was supplied.
 */
export function literalCalls(files = appSources()) {
  const calls = []
  for (const file of files) {
    const text = stripComments(readFileSync(file, 'utf8'))
    for (const m of text.matchAll(/\b(t|tOr|tPlural)\(\s*'([^']+)'/g)) {
      const key = m[2]
      if (!KEY_SHAPE.test(key)) continue
      const paren = text.indexOf('(', m.index)
      const args = balanced(text, paren, '(', ')')
      const objOpen = args.indexOf('{')
      let vars = null
      let judgeable = true
      if (objOpen !== -1) {
        const { names, spread } = propertyNames(balanced(args, objOpen, '{', '}'))
        vars = names
        judgeable = !spread
      }
      calls.push({
        file,
        line: text.slice(0, m.index).split('\n').length,
        fn: m[1],
        key,
        vars,
        judgeable,
      })
    }
  }
  return calls
}

/**
 * Every runtime-built key, as the PREFIX the application interpolates into:
 * `` tOr(`financing.status.${s}`, en) `` yields `financing.status.`.
 *
 * The prefix is never itself a key, so the only checkable claim is that
 * something lives under it. That is what catches a namespace typo.
 */
export function interpolatedPrefixes(files = appSources()) {
  const out = []
  for (const file of files) {
    const text = stripComments(readFileSync(file, 'utf8'))
    for (const m of text.matchAll(
      /\b(?:t|tOr|tPlural)\(\s*`([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_]+)*\.)\$\{/g)) {
      out.push({
        file,
        line: text.slice(0, m.index).split('\n').length,
        prefix: m[1],
      })
    }
  }
  return out
}

/** `tPlural(base, ...)` bases, including those passed as a variable whose
 *  value is declared as `key: 'some.key'` in a lib map. */
export function pluralBases(files = appSources()) {
  const out = new Set()
  const texts = files.map((file) => [file, stripComments(readFileSync(file, 'utf8'))])

  for (const [, text] of texts) {
    for (const m of text.matchAll(/tPlural\(\s*'([a-zA-Z][\w.]*)'/g)) out.add(m[1])
  }

  /**
   * A plural key handed to `tPlural` through a VARIABLE, declared somewhere
   * else as `key: 'bank.warning.missedMilestones'`.
   *
   * The declaration and the call are in different files: `src/lib/bank.ts`
   * builds the objects and `BankMonitoring.tsx` calls `tPlural(w.key, ...)`.
   * Scoping the lookup to one file at a time found neither, so both bases
   * looked unreferenced and their `_plural` forms looked dead.
   */
  const handsVariableKey = texts.some(([, text]) => /tPlural\(\s*\w+\.key/.test(text))
  if (handsVariableKey) {
    for (const [, text] of texts) {
      // A `count` sibling is what makes the declaration a PLURAL one.
      // `src/lib/errors.ts` also declares `{ key: 'error.notAllowed', en: ... }`
      // for a single sentence; collecting those made the guard demand
      // `error.notAllowed_plural`, which rightly does not exist. The count is
      // the difference between "a key" and "a counted key".
      // Looked at as a WINDOW after the declaration rather than as a balanced
      // object: the sibling values contain template literals, so `${...}`
      // breaks any brace matching that assumes no nesting.
      for (const m of text.matchAll(/key:\s*'([a-zA-Z][\w]*(?:\.[\w]+)+)'/g)) {
        const window = text.slice(m.index, m.index + 220)
        if (/\bcount\s*:/.test(window)) out.add(m[1])
      }
    }
  }
  return out
}

/** The placeholders a string declares, e.g. `Release {amount}` -> ['amount']. */
export function placeholders(value) {
  return [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
}

// ---------------------------------------------------------------------------
// Source string classification (Part 7)
// ---------------------------------------------------------------------------

const TAILWIND_HINT = new RegExp(
  '\\b(flex|grid|text-|bg-|border|rounded|px-|py-|p-|m[trblxy]?-|gap-|w-|h-|min-|max-|'
  + 'items-|justify-|font-|leading-|tracking-|shrink|truncate|overflow|ring|shadow|'
  + 'hover:|focus:|sm:|md:|lg:|xl:|absolute|relative|inline|block|hidden|space-[xy]-|divide|'
  + 'animate|cursor|whitespace|align|sr-only|pointer-events|col-span|row-span|order-)')
const CLASSY = /^[a-z0-9:_\-[\]#/.%()&!+,\s*]*$/
const PATHY = /^[/@.]|^https?:|\.(tsx?|css|svg|png|jpe?g|json|csv|mjs)$/
const IDENTLIKE = /^[a-z][a-z0-9_]*$|^[A-Z][A-Z0-9_]*$/
const WORDS = /[A-Za-z]{2,}/
const SQL_COLUMNS = /^[a-z_]+(,\s*[a-z_]+)+$/

/**
 * Modules whose string contents are DATA rather than interface copy.
 *
 * `src/lib/lgas.ts` is 796 Nigerian Local Government Area names. They are
 * place names: they are not translated, they are not written by Loamy, and
 * counting them as untranslated interface copy put them at the top of the
 * "worst files" list for four waves, where they drowned out the files that
 * actually needed work.
 *
 * The legal content is listed for a different reason: it is a document with
 * its own authoritative text, handled by the server-generated-text contract
 * rather than by the key space.
 */
export const DATA_MODULES = [
  'src/lib/lgas.ts',          // Local Government Area names
  'src/lib/nigeria.ts',       // state and commodity names
  'src/content/legal/',       // legal documents, one authoritative text each
]

export function isDataModule(file) {
  return DATA_MODULES.some((d) => file.startsWith(d))
}

/**
 * Which bucket a source string falls into. The buckets are the ones the Part 7
 * brief names, and the function is deliberately conservative: anything it
 * cannot rule out comes back as `candidate`, never as settled.
 *
 *   'class'      a Tailwind class string or style fragment
 *   'internal'   an identifier, route, DB column list, test id, icon name
 *   'key'        an i18n key being passed to the translator
 *   'keyed'      already covered: either the English FALLBACK argument of a
 *                `tOr` call, or a value that is also a canonical pack value in
 *                a file that routes through the translator
 *   'data'       place names, commodity lists, legal document text
 *   'candidate'  interface copy, or something indistinguishable from it
 */
export function classify(value, {
  canonicalValues, fileRoutesThroughT, isFallbackArg, isData,
} = {}) {
  if (!value || value.length < 2 || !WORDS.test(value)) return 'internal'
  if (PATHY.test(value)) return 'internal'
  if (KEY_SHAPE.test(value)) return 'key'
  if (SQL_COLUMNS.test(value)) return 'internal'
  if (TAILWIND_HINT.test(value) && CLASSY.test(value)) return 'class'
  if (!value.includes(' ') && IDENTLIKE.test(value)) return 'internal'
  // The second argument of `tOr(key, english)` is copy by design: the key
  // exists, and the English is what renders until a pack reaches it. Counting
  // it as unreached inverts the meaning of the number.
  if (isFallbackArg) return 'keyed'
  if (isData) return 'data'
  if (canonicalValues && canonicalValues.has(value) && fileRoutesThroughT) return 'keyed'
  return 'candidate'
}

/**
 * The English fallback strings a file passes as the second argument of `tOr`.
 * Collected up front so `classify` can recognise them by value.
 */
export function fallbackArguments(src) {
  const out = new Set()
  for (const m of src.matchAll(/\btOr\(\s*(?:'[^']*'|`[^`]*`)\s*,\s*'((?:[^'\\]|\\.)*)'/g)) {
    out.add(m[1].replace(/\\'/g, "'"))
  }
  for (const m of src.matchAll(/\btOr\(\s*(?:'[^']*'|`[^`]*`)\s*,\s*"((?:[^"\\]|\\.)*)"/g)) {
    out.add(m[1])
  }
  return out
}

/**
 * Candidate interface strings in one file, with the limitation stated: a
 * string this finds is a CANDIDATE. It may be dead code, a server value or an
 * English fallback that `tOr` renders on purpose, and this module cannot tell.
 */
export function candidateStrings(file, canonicalValues) {
  const raw = readFileSync(file, 'utf8')
  const cleaned = stripComments(raw)
  const fallbacks = fallbackArguments(cleaned)
  let src = cleaned.replace(/^import .*$/gm, '')
  // Blank the KEY argument of a translator call. The English fallback is kept
  // in the text but recognised by value, so it lands in `keyed` rather than
  // looking like unreached copy.
  src = src.replace(/\b(t|tOr|tPlural)\(\s*'[^']*'/g, '$1(KEY')
  src = src.replace(/\b(t|tOr|tPlural)\(\s*`[^`]*`/g, '$1(KEY')
  const fileRoutesThroughT = /\buseT\(\)/.test(raw)
  const isData = isDataModule(file)

  const found = new Map()
  const add = (value, index) => {
    const bucket = classify(value, {
      canonicalValues,
      fileRoutesThroughT,
      isFallbackArg: fallbacks.has(value),
      isData,
    })
    if (bucket !== 'candidate') return
    if (!found.has(value)) found.set(value, src.slice(0, index).split('\n').length)
  }
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) add(m[1].replace(/\\'/g, "'"), m.index)
  for (const m of src.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) add(m[1], m.index)
  for (const m of src.matchAll(/>\s*([A-Z][^<>{}\n]{2,160}?)\s*</g)) add(m[1].trim(), m.index)
  for (const m of src.matchAll(/`([^`$\n]{3,160})`/g)) add(m[1], m.index)
  return found
}

// ---------------------------------------------------------------------------
// Legacy formatters (Part 4)
// ---------------------------------------------------------------------------

/**
 * Helpers that format for a FIXED locale and therefore cannot follow the
 * language a member chose. Importing one is how a localized screen ends up
 * rendering en-NG dates to a Yoruba speaker.
 *
 * `formatNaira` is deliberately NOT here. Money keeps the Nigerian convention
 * in every language on purpose, and "fixing" it would be the error.
 */
export const LEGACY_DATE_HELPERS = ['formatDateShort', 'formatDateLong']

/**
 * The files that still use a legacy date helper, as of Wave A.5.
 *
 * THIS IS A RATCHET, NOT AN APPROVAL
 *   73 files inherited the locale-hardcoded helper from before the i18n layer
 *   existed. Replacing all of them in one wave would be a 73-file diff with no
 *   test able to tell a correct migration from a careless one, so instead the
 *   list is frozen: a file ON it may keep its debt, and a file NOT on it may
 *   not take any. New localization work therefore cannot introduce a new
 *   hardcoded date, which is the actual objective.
 *
 *   The list may only SHRINK. A guard asserts that every entry still uses a
 *   legacy helper, so a migrated file must be deleted from here rather than
 *   left behind to make the number look worse than it is.
 *
 * HOW TO LEAVE THE LIST
 *   Take `dateShort` / `dateLong` from `useT()` instead of importing
 *   `formatDateShort` / `formatDateLong` from `@/lib/utils`, then remove the
 *   path. `src/pages/bank/` did exactly that in A.5 and is why it is absent.
 *
 * NOT ON THE LIST, AND NOT A BUG
 *   `formatNaira`. Money keeps the Nigerian convention in every language on
 *   purpose; threading a locale into it would be the defect.
 */
export const LEGACY_DATE_DEBT = [
  'src/components/AdminDataHealth.tsx',
  'src/components/DailyPricesPanel.tsx',
  'src/components/MarketPricesPanel.tsx',
  'src/components/charts/StatusStrip.tsx',
  'src/components/copilot/Copilot.tsx',
  'src/components/fulfilment/FulfilmentPanel.tsx',
  'src/components/fulfilment/LoadingCard.tsx',
  'src/components/fulfilment/StorageCard.tsx',
  'src/components/fulfilment/TransportCard.tsx',
  'src/components/home/HomeSections.tsx',
  'src/lib/contracts.ts',
  'src/lib/copilot/i18n/registry.ts',
  'src/lib/i18n/format.ts',
  'src/lib/i18n/index.tsx',
  'src/pages/admin/AdminAmbassadors.tsx',
  'src/pages/admin/AdminAnnouncements.tsx',
  'src/pages/admin/AdminBankOfficers.tsx',
  'src/pages/admin/AdminCopilot.tsx',
  'src/pages/admin/AdminFees.tsx',
  'src/pages/admin/AdminHome.tsx',
  'src/pages/admin/AdminListingsOversight.tsx',
  'src/pages/admin/AdminLoansFinancing.tsx',
  'src/pages/admin/AdminLogistics.tsx',
  'src/pages/admin/AdminMarketPrices.tsx',
  'src/pages/admin/AdminMonitoring.tsx',
  'src/pages/admin/AdminNotifications.tsx',
  'src/pages/admin/AdminPartners.tsx',
  'src/pages/admin/AdminPaymentsSettlements.tsx',
  'src/pages/admin/AdminSupport.tsx',
  'src/pages/admin/AdminTransactions.tsx',
  'src/pages/admin/AdminUsers.tsx',
  'src/pages/admin/AdminVerificationQueue.tsx',
  'src/pages/admin/FeeRuleDialog.tsx',
  'src/pages/booking/BookingsInbox.tsx',
  'src/pages/booking/MyBookings.tsx',
  'src/pages/farmer/FarmDetail.tsx',
  'src/pages/farmer/FarmerOverview.tsx',
  'src/pages/farmer/Financing.tsx',
  'src/pages/marketplace/Directory.tsx',
  'src/pages/marketplace/ListingDetail.tsx',
  'src/pages/marketplace/MyInterests.tsx',
  'src/pages/marketplace/MyListings.tsx',
  'src/pages/marketplace/OrdersPage.tsx',
  'src/pages/marketplace/ProductCard.tsx',
  'src/pages/marketplace/PublicProductCard.tsx',
  'src/pages/partner/AmbassadorPrices.tsx',
  'src/pages/partner/Earnings.tsx',
  'src/pages/partner/GrowthPartnerOverview.tsx',
  'src/pages/partner/InspectionQueue.tsx',
  'src/pages/partner/MyFarmers.tsx',
  'src/pages/partner/TaskDetail.tsx',
  'src/pages/partner/VerificationTasks.tsx',
  'src/pages/processor/AwardLogistics.tsx',
  'src/pages/processor/BuyRequests.tsx',
  'src/pages/processor/CompanyHub.tsx',
  'src/pages/processor/CompanyTeam.tsx',
  'src/pages/processor/ContractView.tsx',
  'src/pages/processor/Contracts.tsx',
  'src/pages/processor/InspectionReport.tsx',
  'src/pages/processor/Inspections.tsx',
  'src/pages/processor/RfqBidsPanel.tsx',
  'src/pages/public/BuyRequests.tsx',
  'src/pages/public/Landing.tsx',
  'src/pages/public/PublicListingDetail.tsx',
  'src/pages/public/PublicProfile.tsx',
  'src/pages/shared/Home.tsx',
  'src/pages/shared/MyStock.tsx',
  'src/pages/shared/Notifications.tsx',
  'src/pages/shared/PriceUpdates.tsx',
  'src/pages/shared/Support.tsx',
  'src/pages/supplier/OpenRfqs.tsx',
  'src/pages/supplier/TransportBoard.tsx',
  'src/pages/supplier/WarehouseInbox.tsx',
]

/** Files importing a legacy date helper from @/lib/utils. */
export function legacyDateImporters(files = appSources()) {
  const out = []
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@\/lib\/utils'/g)) {
      const named = m[1].split(',').map((x) => x.trim())
      const hit = named.filter((x) => LEGACY_DATE_HELPERS.includes(x))
      if (hit.length) out.push({ file, helpers: hit })
    }
  }
  return out
}

/** Files that still CALL a legacy date helper, as opposed to merely importing
 *  one and having nothing left that uses it. */
export function legacyDateCallers(files = appSources()) {
  const out = []
  for (const file of files) {
    const src = stripComments(readFileSync(file, 'utf8')).replace(/^import .*$/gm, '')
    const calls = []
    for (const helper of LEGACY_DATE_HELPERS) {
      const re = new RegExp(`\\b${helper}\\s*\\(`, 'g')
      const n = [...src.matchAll(re)].length
      if (n) calls.push({ helper, count: n })
    }
    if (calls.length) out.push({ file, calls })
  }
  return out
}

/**
 * Sites that pass a locale LITERAL to a formatter, or pass none and so inherit
 * the browser's. Both make the output independent of the member's choice; the
 * second is worse in one respect, because it varies by machine and so
 * reproduces for one tester and not another.
 */
export function hardcodedLocaleSites(files = appSources()) {
  const out = []
  for (const file of files) {
    const raw = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
    const lines = raw.split('\n')
    lines.forEach((line, i) => {
      const s = line.trim()
      if (s.startsWith('//') || s.startsWith('*')) return
      for (const m of line.matchAll(/(toLocale(?:Date|Time)?String|new Intl\.\w+)\s*\(([^)]*)/g)) {
        const args = m[2]
        let kind = null
        if (/['"`][a-z]{2}(-[A-Z]{2})?['"`]/.test(args)) kind = 'hardcoded'
        else if (args.trim() === '' || args.trim().startsWith('{')) kind = 'browser'
        if (!kind) continue
        /**
         * MONEY is pinned on purpose, so a pinned locale is only a defect when
         * the value is not money.
         *
         * A naira amount reads the same in all five languages because the
         * amount is a business fact, not a presentation choice. Flagging those
         * sites would have taught the next reader to "fix" the one thing in
         * this layer that is already right, so the currency options are looked
         * for in a window around the call.
         */
        const window = lines.slice(Math.max(0, i - 1), i + 5).join(' ')
        const isMoney = /currency\s*:|style\s*:\s*['"`]currency|NGN|₦/.test(window)
        out.push({
          file,
          line: i + 1,
          fn: m[1],
          kind: isMoney ? 'money' : kind,
          text: s.slice(0, 100),
        })
      }
    })
  }
  return out
}
