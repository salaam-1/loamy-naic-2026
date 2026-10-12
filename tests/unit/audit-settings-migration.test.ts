import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The migration that extends configuration auditing to `settings`.
 *
 * WHAT THESE TESTS CAN AND CANNOT DO
 *   This migration HAS NOT BEEN APPLIED to any database. Applying it to
 *   staging needs explicit authorization and production is out of scope, so
 *   nothing here executes SQL. These are static checks on the migration's
 *   SHAPE -- that it is additive, correctly ordered, and does not weaken what
 *   already exists.
 *
 *   The behavioural claims -- that an `audit_events` row appears for a
 *   `settings` change, that `flags` auditing still works, that a
 *   secret-shaped value is rejected and leaves no audit row -- CANNOT be
 *   established without applying it. They are listed in the report as
 *   pending, not as passing.
 */

const DIR = 'supabase/migrations'
const FILE = '20261009100001_loamy_audit_settings_changes.sql'
const sql = readFileSync(`${DIR}/${FILE}`, 'utf8')

describe('the migration is ordered and named by convention', () => {
  it('sorts last, so it replaces the current audit function', () => {
    const all = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
    expect(all[all.length - 1]).toBe(FILE)
  })

  it('follows the repository timestamp-plus-slug naming', () => {
    expect(FILE).toMatch(/^\d{14}_loamy_[a-z0-9_]+\.sql$/)
  })
})

describe('it is additive: existing audit behaviour is preserved', () => {
  it('still records flags before and after', () => {
    expect(sql).toContain("'flags_before', old.flags")
    expect(sql).toContain("'flags_after', new.flags")
  })

  it('still records partner rates before and after', () => {
    expect(sql).toContain("'rates_before', old.partner_rates")
    expect(sql).toContain("'rates_after', new.partner_rates")
  })

  it('adds settings without removing anything', () => {
    expect(sql).toContain("'settings_before', old.settings")
    expect(sql).toContain("'settings_after', new.settings")
    expect(sql).toContain("'settings_changed_keys'")
  })

  it('reuses the established audit helper rather than inserting directly', () => {
    expect(sql).toContain('public.loamy_audit_internal(')
    expect(sql, 'actor and timestamp come from the helper')
      .not.toMatch(/insert\s+into\s+public\.audit_events/i)
  })

  it('keeps the audit function security definer with a pinned search_path', () => {
    const fn = sql.slice(sql.indexOf('function public.loamy_audit_config_change'))
    expect(fn).toContain('security definer')
    expect(fn).toContain('set search_path = public')
  })

  it('drops no existing policy, table or column', () => {
    for (const destructive of [
      /drop\s+table/i, /drop\s+column/i, /drop\s+policy/i,
      /alter\s+table[^;]*drop/i, /truncate/i, /delete\s+from/i,
    ]) {
      expect(sql, String(destructive)).not.toMatch(destructive)
    }
  })

  it('only ever drops triggers it immediately recreates', () => {
    const dropped = [...sql.matchAll(/drop trigger if exists (\w+)/g)].map((m) => m[1])
    const created = [...sql.matchAll(/create trigger (\w+)/g)].map((m) => m[1])
    expect(dropped.length).toBeGreaterThan(0)
    for (const d of dropped) expect(created, d).toContain(d)
  })
})

describe('the database-level secret guard', () => {
  it('refuses credential-shaped keys', () => {
    const fn = sql.slice(sql.indexOf('loamy_settings_reject_secrets'))
    for (const word of ['token', 'secret', 'password', 'credential', 'apikey', 'privatekey']) {
      expect(fn.toLowerCase(), word).toContain(word)
    }
  })

  it('extracts the LAST path segment before testing it', () => {
    /**
     * REGRESSION, and a real bypass found by review rather than by a test.
     *
     * The first version tested the whole dotted path against
     * `(^|[._])(token|...)$`. For `ai.inference.hostedToken` the character
     * before "Token" is "d", so nothing matched and a credential-shaped key
     * passed the guard. A dotted-path regex anchored on `[._]` cannot see the
     * boundary inside camelCase.
     *
     * The segment is now extracted first, then tested two ways.
     */
    expect(sql, 'the old dotted-path form must be gone')
      .not.toContain("k ~* '(^|[._])")
    expect(sql, 'the last path segment is extracted before testing it')
      .toContain('segment := regexp_replace(path,')
    expect(sql, 'and a trailing array index is stripped')
      .toContain('segment := regexp_replace(segment,')
  })

  it('catches a camelCase credential suffix, case-sensitively and singular', () => {
    const suffix = sql.match(/segment ~ '\(([^)]+)\)\$'/)
    expect(suffix, 'a camelCase suffix check must exist').not.toBeNull()
    const alternatives = suffix![1].split('|')
    // Singular only: `Tokens` must not be in the list, or a token COUNT would
    // be rejected and an operator would work around the trigger.
    expect(alternatives).toContain('Token')
    expect(alternatives).not.toContain('Tokens')
    // Case-sensitive `~`, not `~*`: `maxOutputTokens` ends in "Tokens" and a
    // case-insensitive match on "token" would catch it.
    expect(suffix![0].startsWith("segment ~ '")).toBe(true)
    expect(suffix![0]).not.toContain("~*")
  })

  it('mirrors the application guard, so the two layers cannot disagree', () => {
    const app = readFileSync('src/lib/aiSettings.ts', 'utf8')
    const appSuffix = app.match(/SECRET_SUFFIX = \/\(\?:([^)]+)\)\$\//)
    const sqlSuffix = sql.match(/segment ~ '\(([^)]+)\)\$'/)
    expect(appSuffix).not.toBeNull()
    expect(sqlSuffix).not.toBeNull()
    expect(sqlSuffix![1].split('|').sort()).toEqual(appSuffix![1].split('|').sort())
  })

  it('guards INSERT as well as UPDATE', () => {
    /**
     * `service_role` bypasses RLS, and an upsert may take either path.
     * Covering both removes the need to reason about which.
     */
    expect(sql).toContain('before insert or update on public.platform_config')
  })

  it('compares old and new with is-not-distinct-from, not =', () => {
    // `new.settings = old.settings` is NULL when either side is NULL, and a
    // NULL condition would skip validation rather than run it.
    expect(sql).toContain('is not distinct from old.settings')
    expect(sql).not.toContain('new.settings = old.settings')
  })

  it('refuses credential-shaped VALUES under any key', () => {
    const fn = sql.slice(sql.indexOf('loamy_settings_reject_secrets'))
    expect(fn).toContain('hf_')
    expect(fn).toContain('sk-')
    expect(fn).toContain('eyJ')
    expect(fn.toLowerCase()).toContain('bearer')
  })

  it('walks nested documents, not just the top level', () => {
    // A credential three objects deep is still a credential.
    expect(sql).toContain('loamy_jsonb_flatten')
    expect(sql).toMatch(/jsonb_array_elements/)
  })

  it('raises check_violation so the caller gets a usable error class', () => {
    expect(sql).toContain("errcode = 'check_violation'")
  })

  it('does not echo the offending VALUE in the exception', () => {
    /**
     * The message names the PATH, never the value. An error that quoted the
     * credential it refused would be its own disclosure -- into logs, into a
     * browser, into a support thread.
     */
    const raises = [...sql.matchAll(/raise exception\s+([\s\S]*?)using errcode/g)]
    expect(raises.length).toBeGreaterThan(0)
    for (const r of raises) {
      expect(r[1], 'only the key/path may be interpolated').not.toContain('leaf')
      expect(r[1]).not.toContain('new.settings')
    }
  })
})

describe('ordering: a rejected secret leaves no audit row', () => {
  it('rejects BEFORE update and audits AFTER update', () => {
    /**
     * The reject trigger must fire first, so a refused change raises before
     * any audit row is written. An audit trail that recorded the credential
     * it refused would defeat the purpose.
     */
    // Tolerates `before insert or update`, which the reject trigger now uses.
    const reject = sql.match(/create trigger loamy_platform_config_reject_secrets\s+(before|after)\b/)
    const audit = sql.match(/create trigger loamy_platform_config_audit\s+(before|after)\b/)
    expect(reject?.[1], 'reject must run first').toBe('before')
    expect(audit?.[1], 'audit must run only after the change is accepted').toBe('after')
  })

  it('says so in the file, for whoever reads it next', () => {
    expect(sql.toLowerCase()).toContain('before any audit row is written')
  })
})

describe('the migration states it has not been applied', () => {
  it('carries that warning in the header', () => {
    const header = sql.slice(0, 2000).toLowerCase()
    expect(header).toContain('not applied')
    expect(header).toContain('authorization')
  })

  it('names the pre-existing gap rather than implying it is new', () => {
    const header = sql.slice(0, 2000)
    expect(header).toContain('eligibility weights')
    expect(header.toLowerCase()).toContain('did not create it')
  })
})
