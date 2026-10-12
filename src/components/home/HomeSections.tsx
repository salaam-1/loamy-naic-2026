import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, Boxes, CircleDashed, Clock, Dot, type LucideIcon,
} from 'lucide-react'
import { Price, Quantity } from '@/components/Money'
import { StatusPill, type Tone } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { cn, formatDateShort } from '@/lib/utils'
import type { HomeTransaction } from '@/lib/home'

/**
 * The non-hero pieces of Home.
 *
 * The composition rule from §19: not card, card, card, card. Each of these
 * has a different shape because it does a different job —
 *
 *   Section        an editorial heading with an optional "see all", used to
 *                  separate bands of content WITHOUT wrapping them in a card.
 *                  This is what stops Home reading as a grid of boxes.
 *   QuickActions   a compact row of chips, not four big tiles.
 *   ActiveDeal     a wide panel with a live progress rail.
 *   ActivityFeed   a timeline, no card per row.
 */

// ---------------------------------------------------------------------------
// Section heading
// ---------------------------------------------------------------------------

export function Section({
  title,
  hint,
  action,
  children,
  className,
}: {
  title: string
  hint?: string
  action?: { label: string; to: string }
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('space-y-3', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight text-emerald-950">{title}</h2>
          {hint && <p className="mt-0.5 text-[12px] text-emerald-900/50">{hint}</p>}
        </div>
        {action && (
          /* -my-2 -mr-2 with py-2 px-2: the TARGET is 36px tall and reaches
             the edge, while the text still sits on the same baseline as the
             heading. A 19px text link is a 19px tap target, which is why
             these four were the only things on Home failing the touch
             minimum. Padding fixes the target without moving the layout. */
          <Link
            to={action.to}
            className="-my-2 -mr-2 touch-target shrink-0 rounded px-2 py-2 text-[13px] font-medium text-emerald-700 hover:bg-sand/70 hover:text-emerald-800"
          >
            {action.label} →
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Quick actions
// ---------------------------------------------------------------------------

export interface QuickAction {
  label: string
  to: string
  icon: LucideIcon
  /** The one action worth leading with, if any. */
  primary?: boolean
}

/**
 * A row of chips rather than a grid of tiles.
 *
 * Four big equal tiles give every action the same weight, which is the same
 * as giving none of them any. These are sized to their labels and scroll
 * horizontally on a phone instead of wrapping into a second wall.
 */
export function QuickActions({ actions }: { actions: QuickAction[] }) {
  if (actions.length === 0) return null
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
        {actions.map((a) => {
          const Icon = a.icon
          return (
            <Link
              key={a.to + a.label}
              to={a.to}
              className={cn(
                'inline-flex h-10 min-h-touch shrink-0 items-center gap-2 rounded-pill px-4 text-[13px] font-medium transition-all',
                a.primary
                  ? 'bg-brand-fill text-white shadow-sm ring-1 ring-inset ring-white/10 hover:shadow-md'
                  : 'border border-clay/80 bg-white/70 text-emerald-900 backdrop-blur-[2px] hover:border-clay hover:bg-white',
              )}
            >
              <Icon className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              {a.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Active deal
// ---------------------------------------------------------------------------

/**
 * Three independent state machines on one transaction row: `status`,
 * `payment_state` and `fulfilment_state`. They are shown as three separate
 * rails because collapsing them into one bar would have to invent an ordering
 * between them that the database does not have.
 */
const RAIL: { key: 'status' | 'payment_state' | 'fulfilment_state'; label: string }[] = [
  { key: 'status', label: 'Deal' },
  { key: 'payment_state', label: 'Payment' },
  { key: 'fulfilment_state', label: 'Delivery' },
]

function toneFor(value: string | null): Tone {
  if (!value) return 'neutral'
  if (/complete|released|delivered|settled|paid|accepted|concluded/.test(value)) return 'verified'
  if (/dispute|cancel|reject|fail/.test(value)) return 'blocked'
  if (/pending|await|review|progress|transit|loading|proposed/.test(value)) return 'pending'
  return 'neutral'
}

function humanise(value: string | null): string {
  if (!value) return 'Not started'
  return value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

export function ActiveDeal({ txn, to }: { txn: HomeTransaction; to: string }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-clay bg-sand/40 px-5 py-4">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-emerald-900/50">
            {txn.side === 'buying' ? 'You are buying' : 'You are selling'}
            {txn.ref && <span className="font-mono normal-case tracking-normal">{txn.ref}</span>}
          </p>
          <p className="mt-1 text-lg font-semibold tracking-tight text-emerald-950">{txn.commodity}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Quantity value={Number(txn.quantity)} unit={txn.unit} size="sm" />
            <Price amount={Number(txn.subtotal)} size="sm" />
            <span className="text-[11px] text-emerald-900/45">
              opened {formatDateShort(txn.created_at)}
            </span>
          </div>
        </div>
        <Link
          to={to}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-control bg-brand-fill px-4 text-[13px] font-semibold text-white shadow-sm ring-1 ring-inset ring-white/10 hover:shadow-md"
        >
          View <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>

      <div className="grid gap-3 px-5 py-4 sm:grid-cols-3">
        {RAIL.map(({ key, label }) => {
          const value = txn[key]
          const tone = toneFor(value)
          return (
            <div key={key}>
              <p className="text-[11px] font-medium text-emerald-900/45">{label}</p>
              <div className="mt-1">
                <StatusPill label={humanise(value)} tone={tone} pulse={tone === 'pending'} />
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

export interface ActivityItem {
  id: string
  title: string
  detail?: string
  at: string
  to?: string
  tone?: Tone
}

/**
 * A timeline, not a table and not a stack of cards.
 *
 * The rail on the left is what makes a list of events read as a history
 * rather than as rows. Each entry links to the entity it is about, because an
 * activity feed you cannot act on is a changelog.
 */
export function ActivityFeed({ items, empty }: { items: ActivityItem[]; empty: ReactNode }) {
  if (items.length === 0) return <>{empty}</>
  return (
    <ol className="relative space-y-4 border-l border-clay pl-5">
      {items.map((item) => {
        const body = (
          <>
            <span
              className={cn(
                'absolute -left-[26px] top-1 grid h-3 w-3 place-items-center rounded-full border-2 border-bone',
                item.tone === 'verified' ? 'bg-emerald-600'
                  : item.tone === 'pending' ? 'bg-amber-500'
                    : item.tone === 'blocked' ? 'bg-rose-500'
                      : 'bg-emerald-900/25',
              )}
              aria-hidden
            />
            <p className="text-[13px] font-medium text-emerald-950">{item.title}</p>
            {item.detail && <p className="mt-0.5 text-[12px] text-emerald-900/55">{item.detail}</p>}
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-emerald-900/40">
              <Clock className="h-3 w-3" aria-hidden /> {formatDateShort(item.at)}
            </p>
          </>
        )
        return (
          <li key={item.id} className="relative">
            {item.to ? (
              <Link to={item.to} className="block rounded transition-colors hover:bg-sand/60">
                {body}
              </Link>
            ) : body}
          </li>
        )
      })}
    </ol>
  )
}

// ---------------------------------------------------------------------------
// Empty states
// ---------------------------------------------------------------------------

/**
 * An empty state that is part of the environment rather than a grey box.
 *
 * §34 and §20: no giant solid-colour panel. A translucent Level-1 surface
 * with a line of copy and one action — it should read as "nothing here yet",
 * not as "something failed".
 */
export function HomeEmpty({
  icon: Icon = Boxes,
  title,
  body,
  action,
}: {
  icon?: LucideIcon
  title: string
  body: string
  action?: { label: string; to: string }
}) {
  return (
    <Card variant="plain" className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sand text-emerald-700">
        <Icon className="h-5 w-5" strokeWidth={1.5} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium text-emerald-950">{title}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-emerald-900/60">{body}</p>
      </div>
      {action && (
        <Link
          to={action.to}
          className="inline-flex h-10 min-h-touch shrink-0 items-center gap-1.5 rounded-control border border-clay bg-white px-4 text-[13px] font-semibold text-emerald-900 hover:bg-sand"
        >
          {action.label}
        </Link>
      )}
    </Card>
  )
}

/** A compact figure for a band of two or three related numbers. */
export function Figure({
  label, value, hint, icon: Icon = Dot, to,
}: {
  label: string
  value: string
  hint?: string
  icon?: LucideIcon
  to?: string
}) {
  const inner = (
    <>
      <div className="flex items-center gap-1.5 text-emerald-900/50">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
        <span className="text-[11px] font-medium">{label}</span>
      </div>
      <p className="mt-1 tabular text-xl font-semibold tracking-tight text-emerald-950">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-emerald-900/45">{hint}</p>}
    </>
  )
  return to ? (
    <Link to={to} className="rounded-lg p-3 transition-colors hover:bg-sand/60">{inner}</Link>
  ) : (
    <div className="p-3">{inner}</div>
  )
}

export { CircleDashed }
