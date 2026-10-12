import {
  AlertTriangle, ArrowRight, Ban, Check, CircleDashed, Clock, MinusCircle,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import {
  STAGE_TONE, STAGE_WORD, currentStage, progress, responsibleLabel,
  type Journey, type JourneyStage, type StageStatus,
} from '@/lib/financing'
import { cn } from '@/lib/utils'

const ICON: Record<StageStatus, typeof Check> = {
  done: Check,
  active: ArrowRight,
  waiting: Clock,
  blocked: AlertTriangle,
  failed: Ban,
  skipped: MinusCircle,
  pending: CircleDashed,
}

const TONE_CLASS = {
  good: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  busy: 'bg-white text-emerald-800 border-emerald-300',
  warn: 'bg-amber-50 text-amber-800 border-amber-300',
  bad: 'bg-rose-50 text-rose-800 border-rose-200',
  idle: 'bg-emerald-900/[0.03] text-emerald-900/40 border-line',
}

/**
 * The ten-stage purchase tracker.
 *
 * Every line states its status, whose move it is, and what happens next —
 * all computed server-side by loamy_transaction_journey, so the tracker
 * cannot drift from the database.
 *
 * A stage the buyer must act on is called "Your move"; one that is merely in
 * progress is not. That distinction is the point of the component.
 */
export function JourneyTracker({ journey }: { journey: Journey }) {
  const stages = journey.stages ?? []
  const now = currentStage(stages)
  const p = progress(stages)

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-emerald-950">Progress</h2>
          <p className="font-mono text-xs text-emerald-900/55">
            {p.done} of {p.total} stages
          </p>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded bg-emerald-900/10">
          <div
            className="h-full bg-emerald-700 transition-[width] duration-500"
            style={{ width: `${p.percent}%` }}
            role="progressbar"
            aria-valuenow={p.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Purchase progress"
          />
        </div>

        {now && (
          <div className="mt-3 border-t border-line pt-3">
            <p className="text-xs font-medium text-emerald-900/60">Right now</p>
            <p className="mt-0.5 text-sm font-semibold text-emerald-950">{now.label}</p>
            {now.your_action ? (
              <p className="mt-1 text-sm text-emerald-900/80">{now.your_action}</p>
            ) : now.next ? (
              <p className="mt-1 text-sm text-emerald-900/70">{now.next}</p>
            ) : null}
            <p className="mt-1 text-xs text-emerald-900/50">
              Waiting on: {responsibleLabel(now.responsible)}
            </p>
          </div>
        )}
      </Card>

      <ol className="space-y-1.5">
        {stages.map((s) => <StageRow key={s.code} stage={s} />)}
      </ol>
    </div>
  )
}

function StageRow({ stage }: { stage: JourneyStage }) {
  const tone = STAGE_TONE[stage.status]
  const Icon = ICON[stage.status]
  const muted = stage.status === 'skipped' || stage.status === 'pending'

  return (
    <li>
      <Card className={cn('p-3', muted && 'bg-emerald-900/[0.02]')}>
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border',
              TONE_CLASS[tone],
            )}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className={cn(
                'text-sm font-medium',
                muted ? 'text-emerald-900/50' : 'text-emerald-950',
              )}>
                {stage.step}. {stage.label}
              </h3>
              <span className={cn(
                'rounded border px-1.5 py-0.5 text-[11px] font-medium',
                TONE_CLASS[tone],
              )}>
                {STAGE_WORD[stage.status]}
              </span>
              {stage.is_sandbox && (
                <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                  Sandbox
                </span>
              )}
            </div>

            {stage.detail && (
              <p className="mt-0.5 font-mono text-[11px] text-emerald-900/45">{stage.detail}</p>
            )}

            {stage.your_action && (
              <p className="mt-1 text-xs font-medium text-emerald-800">{stage.your_action}</p>
            )}
            {!stage.your_action && stage.next && (
              <p className="mt-1 text-xs text-emerald-900/65">{stage.next}</p>
            )}

            {/* The agent is never named to the parties. */}
            {stage.agent_display && (
              <p className="mt-1 text-xs text-emerald-900/55">{stage.agent_display}</p>
            )}

            {stage.blocked_by && stage.blocked_by.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {stage.blocked_by.map((b) => (
                  <li key={b} className="text-[11px] text-amber-800">
                    · waiting on {b.replace(/_/g, ' ')}
                  </li>
                ))}
              </ul>
            )}

            {stage.flags && stage.flags.length > 0 && (
              <p className="mt-1 text-[11px] text-amber-800">
                Flagged: {stage.flags.join(', ').replace(/_/g, ' ')}
              </p>
            )}

            {!muted && (
              <p className="mt-1 text-[11px] text-emerald-900/40">
                {responsibleLabel(stage.responsible)}
              </p>
            )}
          </div>
        </div>
      </Card>
    </li>
  )
}
