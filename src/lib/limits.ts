/**
 * How many rows a browser list read is allowed to ask for.
 *
 * WHY A CAP AND NOT "ALL OF THEM"
 *   PostgREST already caps a `.select()` at 1000 rows, silently. A query
 *   written without `.limit()` is therefore not unbounded in effect -- it is
 *   unbounded in INTENT and truncated in practice, which is the worst of both:
 *   the code claims to read everything, the server returns the first thousand
 *   in whatever order the planner chose, and nothing anywhere says so. A
 *   procurement director with 1,100 contracts sees 1,000 of them and no
 *   indication that 100 are missing.
 *
 *   An explicit limit does not fix that; it makes it legible. The cap is in
 *   one place, the list reads order deterministically so the capped page is
 *   stable between loads, and `isCapped()` lets a surface say "showing the
 *   first N" rather than implying it showed everything.
 *
 * THIS IS NOT PAGINATION
 *   There is no cursor, no page 2, and no infinite scroll. Those are a
 *   separate piece of work, per surface, with their own design. What is here
 *   is the honest floor beneath them: a bounded read that admits it is bounded.
 *   `docs/processor-localization-report.md` records which surfaces will need
 *   real paging first.
 *
 * WHY 500 RATHER THAN 1000
 *   Comfortably inside PostgREST's own ceiling, so the cap that applies is the
 *   one written here rather than one the server imposes invisibly. A list that
 *   reaches 500 rows is a list that needed paging, not a bigger number.
 */
export const PROCUREMENT_LIST_LIMIT = 500

/**
 * Did this read hit the cap? True means the list is incomplete and a surface
 * showing it should say so rather than presenting it as the whole set.
 */
export function isCapped(rows: readonly unknown[], limit = PROCUREMENT_LIST_LIMIT): boolean {
  return rows.length >= limit
}

/**
 * The bank portal's list cap.
 *
 * Separate from the procurement one because the stakes differ. A procurement
 * list that silently truncates hides a buy request. A LOAN BOOK that silently
 * truncates hides an instalment, and an officer reading a repayments screen has
 * no way to tell that the overdue row they were looking for is on the far side
 * of a limit nobody wrote down.
 */
export const BANK_LIST_LIMIT = 500

/**
 * The ceiling for a read whose rows are AGGREGATED rather than listed: a
 * borrower-exposure total, an unverified-borrower count, a status donut.
 *
 * WHY THIS IS A BOUND AND NOT A FIX
 *   These reads have to cover the whole set to be arithmetically right, so a
 *   cap cannot make them correct -- it can only make the cap visible. PostgREST
 *   already stops at its own `db-max-rows` (1000 by default) whatever we ask
 *   for, so an institution with more facilities than that ceiling is ALREADY
 *   getting totals computed over a subset, today, with nothing saying so.
 *
 *   Writing the limit down does not repair the arithmetic. It states the
 *   assumption in the code so the next reader can see what breaks and when.
 *   The actual fix is a server-side aggregate, which is a schema and function
 *   change rather than a localization one, and is recorded in
 *   `docs/bank-localization-report.md` instead of being attempted here.
 */
export const BANK_AGGREGATE_CEILING = 5000
