import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { MapPin, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { useAuth } from '@/context/AuthContext'
import { TASK_STATUS_META, type TaskFarmInfo, type VerificationTask } from '@/lib/partner'
import { cn, formatDateShort } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DashboardCard } from '@/components/DashboardCard'
import { EmptyState } from '@/components/EmptyState'

/**
 * can_verify partners only: the unassigned pool inside their territory
 * (self-claim) and their own task list. Partners without the capability are
 * redirected — they see no verification surface at all.
 */
export default function VerificationTasks() {
  const navigate = useNavigate()
  const { t, tOr } = useT()
  const { profile, canVerify } = useAuth()
  const [pool, setPool] = useState<VerificationTask[] | null>(null)
  const [mine, setMine] = useState<VerificationTask[]>([])
  const [farmInfo, setFarmInfo] = useState<Record<string, TaskFarmInfo>>({})
  const [claiming, setClaiming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!profile) return
    const { data } = await supabase
      .from('verification_tasks')
      .select('*')
      .order('created_at', { ascending: false })
    const tasks = (data as VerificationTask[]) ?? []
    setPool(tasks.filter((t) => t.status === 'pending' && !t.assigned_to))
    setMine(tasks.filter((t) => t.assigned_to === profile.id))

    // Limited farm surface per task (server decides how much the caller sees).
    const infos: Record<string, TaskFarmInfo> = {}
    await Promise.all(
      tasks.map(async (t) => {
        const { data: info } = await supabase.rpc('loamy_task_farm_info', { p_task: t.id })
        if (info?.[0]) infos[t.id] = info[0] as TaskFarmInfo
      }),
    )
    setFarmInfo(infos)
  }, [profile])

  useEffect(() => {
    void load()
  }, [load])

  if (profile && !canVerify && profile.role !== 'admin') {
    return <Navigate to="/dashboard/growth_partner" replace />
  }

  /**
   * Claim a task through the BLOCK 5 lifecycle.
   *
   * This called `loamy_claim_verification_task` — the deprecated Stage 4
   * path, which predates evidence integrity, GPS and fraud checks, the
   * accept/decline step and the anonymous-agent model. It was the last
   * production caller of that function.
   *
   * `loamy_claim_task` is the authoritative one: same intent, but it holds
   * the agent-eligibility, one-agent-per-task and expiry rules the rest of
   * the verification workflow depends on. The agent then ACCEPTS the task,
   * which is a separate, deliberate commitment — claiming reserves it,
   * accepting is taking the job on.
   */
  async function claim(taskId: string) {
    setError(null)
    setClaiming(taskId)
    const { error: rpcErr } = await supabase.rpc('loamy_claim_task', { p_task_id: taskId })
    setClaiming(null)
    if (rpcErr) {
      setError(errorMessage(rpcErr, 'That task could not be claimed.'))
      return
    }
    navigate(`/dashboard/growth_partner/verification-tasks/${taskId}`)
  }

  if (pool === null) {
    return <div className="h-40 animate-pulse rounded-card bg-white" aria-label={t('verification.fieldOps.loadingTasks')} />
  }

  const TaskLine = ({ task }: { task: VerificationTask }) => {
    const info = farmInfo[task.id]
    // chip (colour) from the lib map, words from the pack
    const meta = TASK_STATUS_META[task.status]
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-emerald-950">
            {info?.farm_name ?? t('verification.partner.farmVerification')}
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-emerald-900/55">
            <MapPin className="h-3.5 w-3.5" aria-hidden />
            {info ? `${info.lga}, ${info.state} · ${Number(info.size_hectares)} ha` : '-'} ·{' '}
            {t('verification.partner.requestedOn', { date: formatDateShort(task.created_at) })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn('rounded px-2.5 py-1 text-xs font-medium', meta.chip)}>
            {tOr(`verification.partnerTaskState.${task.status}`, meta.label)}
          </span>
          {task.status === 'pending' ? (
            <Button size="sm" loading={claiming === task.id} onClick={() => claim(task.id)}>
              {t('verification.fieldOps.claim')}
            </Button>
          ) : (
            <Link
              to={`/dashboard/growth_partner/verification-tasks/${task.id}`}
              className="touch-target text-xs font-semibold text-emerald-700 hover:text-emerald-800"
            >
              {t('verification.partner.open')}
            </Link>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <DashboardCard title={`Territory pool (${pool.length})`}>
        {pool.length === 0 ? (
          <p className="py-4 text-sm text-emerald-900/50">
            {t('verification.fieldOps.noUnassigned')}
          </p>
        ) : (
          <div className="divide-y divide-emerald-950/5">
            {pool.map((task) => <TaskLine key={task.id} task={task} />)}
          </div>
        )}
      </DashboardCard>

      {mine.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={t('verification.fieldOps.noTasksAssigned')}
          body={t('verification.tasks.noneAssignedHint')}
        />
      ) : (
        <DashboardCard title={`My tasks (${mine.length})`}>
          <div className="divide-y divide-emerald-950/5">
            {mine.map((task) => <TaskLine key={task.id} task={task} />)}
          </div>
        </DashboardCard>
      )}
    </div>
  )
}
