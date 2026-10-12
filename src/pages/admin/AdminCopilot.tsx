import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import { AlertTriangle, CheckCircle2, Trash2, Upload } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { cn, formatDateShort } from '@/lib/utils'
import { DashboardCard } from '@/components/DashboardCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { commitUpload, validateUpload, type UploadValidation } from '@/lib/copilot/upload'
import { AdminDataHealth } from '@/components/AdminDataHealth'
import type {
  CopilotFlaggedQuestion, CopilotMessage, CopilotQaOverride, UploadBatch, UploadDataType,
} from '@/lib/copilot/types'

type Tab = 'health' | 'uploads' | 'batches' | 'overrides' | 'flagged' | 'audit'
const TABS: { key: Tab; label: string }[] = [
  { key: 'health', label: 'Data health' },
  { key: 'uploads', label: 'Data uploads' },
  { key: 'batches', label: 'Batches' },
  { key: 'overrides', label: 'Q&A overrides' },
  { key: 'flagged', label: 'Flagged questions' },
  { key: 'audit', label: 'Audit' },
]

type Msg = { ok: boolean; text: string } | null

/**
 * Co-pilot admin — data upload portal, batch rollback, Q&A overrides, the
 * flagged-question loop, and an answer audit. Admin-only (RLS enforces it too).
 * This surface is NOT gated by the `copilot` flag so the team can load and
 * curate data before activating the assistant.
 */
export default function AdminCopilot() {
  const { profile } = useAuth()
  const [tab, setTab] = useState<Tab>('health')

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-emerald-950">Loamy Co-pilot</h1>
        <p className="mt-1 text-sm text-emerald-900/60">
          The Co-pilot answers only from the data uploaded here. It reports observed prices and patterns -
          it never predicts prices or gives advice.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              tab === t.key ? 'border-emerald-800 text-emerald-900' : 'border-transparent text-emerald-900/55 hover:text-emerald-900',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'health' && <AdminDataHealth />}
      {tab === 'uploads' && <UploadsTab userId={profile?.id ?? ''} />}
      {tab === 'batches' && <BatchesTab />}
      {tab === 'overrides' && <OverridesTab userId={profile?.id ?? ''} />}
      {tab === 'flagged' && <FlaggedTab />}
      {tab === 'audit' && <AuditTab />}
    </div>
  )
}

// --- Uploads -----------------------------------------------------------------

function UploadsTab({ userId }: { userId: string }) {
  const [dataType, setDataType] = useState<UploadDataType>('prices')
  const [fileName, setFileName] = useState('')
  const [notes, setNotes] = useState('')
  const [result, setResult] = useState<UploadValidation | null>(null)
  const [msg, setMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState(false)

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    setMsg(null)
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    const text = await file.text()
    setResult(validateUpload(text, dataType))
  }

  async function commit() {
    if (!result || result.accepted.length === 0) return
    setBusy(true)
    setMsg(null)
    const res = await commitUpload({ dataType, fileName, notes, rows: result.accepted, uploadedBy: userId })
    setBusy(false)
    if (res.ok) {
      setMsg({ ok: true, text: `Uploaded ${res.inserted} rows as a new active batch.` })
      setResult(null); setFileName(''); setNotes('')
    } else {
      setMsg({ ok: false, text: res.error })
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <DashboardCard title="Upload data">
        <div className="space-y-3">
          <div>
            <Label htmlFor="up_type">Data type</Label>
            <Select id="up_type" value={dataType} onChange={(e) => { setDataType(e.target.value as UploadDataType); setResult(null) }}>
              <option value="prices">Prices (market_prices_history)</option>
              <option value="macro">Macro context</option>
              <option value="events">Market events</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="up_file">CSV file</Label>
            <input
              id="up_file"
              type="file"
              accept=".csv,text/csv"
              onChange={onFile}
              className="block w-full text-sm text-emerald-900/70 file:mr-3 file:rounded file:border file:border-line file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-emerald-800 hover:file:bg-emerald-50"
            />
            <p className="mt-1 text-[11px] text-emerald-900/45">
              CSV in v1. Excel (.xlsx) plugs into the same validator via a SheetJS reader - see HANDOFF.md.
            </p>
          </div>
          <div>
            <Label htmlFor="up_notes">Notes</Label>
            <Input id="up_notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. WFP retail prices, 2014–2026" />
          </div>
          {msg && (
            <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800' : 'rounded bg-red-50 px-3 py-2 text-sm text-red-700'}>
              {msg.text}
            </p>
          )}
        </div>
      </DashboardCard>

      <DashboardCard title="Validation">
        {!result ? (
          <p className="py-6 text-sm text-emerald-900/50">Choose a file to validate against the schema.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="inline-flex items-center gap-1.5 rounded bg-emerald-50 px-2 py-1 font-medium text-emerald-800">
                <CheckCircle2 className="h-4 w-4" aria-hidden /> {result.accepted.length} accepted
              </span>
              <span className={cn('inline-flex items-center gap-1.5 rounded px-2 py-1 font-medium', result.rejected.length ? 'bg-red-50 text-red-700' : 'bg-emerald-950/5 text-emerald-900/50')}>
                <AlertTriangle className="h-4 w-4" aria-hidden /> {result.rejected.length} rejected
              </span>
              <Button className="ml-auto" onClick={commit} loading={busy} disabled={result.accepted.length === 0}>
                <Upload className="h-4 w-4" aria-hidden /> Commit {result.accepted.length} rows
              </Button>
            </div>
            {result.rejected.length > 0 && (
              <div className="max-h-64 overflow-auto rounded border border-line">
                <table className="w-full text-left text-[12px]">
                  <thead className="sticky top-0 bg-surface text-emerald-900/55">
                    <tr><th className="px-2 py-1.5">Line</th><th className="px-2 py-1.5">Reason</th><th className="px-2 py-1.5">Row</th></tr>
                  </thead>
                  <tbody>
                    {result.rejected.slice(0, 200).map((r) => (
                      <tr key={r.line} className="border-t border-line">
                        <td className="px-2 py-1.5 text-emerald-900/50">{r.line}</td>
                        <td className="px-2 py-1.5 text-red-700">{r.reason}</td>
                        <td className="max-w-xs truncate px-2 py-1.5 text-emerald-900/45">{r.raw}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </DashboardCard>
    </div>
  )
}

// --- Batches -----------------------------------------------------------------

function BatchesTab() {
  const [batches, setBatches] = useState<UploadBatch[]>([])
  const load = useCallback(async () => {
    const { data } = await supabase.from('upload_batches').select('*').order('uploaded_at', { ascending: false })
    setBatches((data as UploadBatch[]) ?? [])
  }, [])
  useEffect(() => { void load() }, [load])

  async function toggle(b: UploadBatch) {
    await supabase.from('upload_batches').update({ active: !b.active }).eq('id', b.id)
    await load()
  }

  return (
    <DashboardCard title="Upload batches">
      <p className="mb-3 text-[12px] text-emerald-900/55">The Co-pilot uses ACTIVE batches only. Deactivate a batch to roll it back instantly.</p>
      {batches.length === 0 ? (
        <p className="py-4 text-sm text-emerald-900/50">No uploads yet.</p>
      ) : (
        <div className="overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[12px] text-emerald-900/55">
              <tr><th className="py-1.5">File</th><th className="py-1.5">Type</th><th className="py-1.5">Rows</th><th className="py-1.5">Uploaded</th><th className="py-1.5">Status</th><th /></tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="border-t border-line">
                  <td className="py-2 pr-3 font-medium text-emerald-950">{b.file_name}</td>
                  <td className="py-2 pr-3 text-emerald-900/60">{b.data_type}</td>
                  <td className="py-2 pr-3 font-mono text-emerald-900/60">{b.row_count}</td>
                  <td className="py-2 pr-3 text-emerald-900/60">{formatDateShort(b.uploaded_at)}</td>
                  <td className="py-2 pr-3">
                    <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', b.active ? 'bg-emerald-50 text-emerald-700' : 'bg-emerald-950/5 text-emerald-900/45')}>
                      {b.active ? 'Active' : 'Rolled back'}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    <Button variant="outline" size="sm" onClick={() => toggle(b)}>{b.active ? 'Deactivate' : 'Reactivate'}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashboardCard>
  )
}

// --- Overrides ---------------------------------------------------------------

function OverridesTab({ userId }: { userId: string }) {
  const [rows, setRows] = useState<CopilotQaOverride[]>([])
  const [pattern, setPattern] = useState('')
  const [answerText, setAnswerText] = useState('')
  const [language, setLanguage] = useState<'en' | 'ha'>('en')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase.from('copilot_qa_overrides').select('*').order('created_at', { ascending: false })
    setRows((data as CopilotQaOverride[]) ?? [])
  }, [])
  useEffect(() => { void load() }, [load])

  async function add() {
    if (!pattern.trim() || !answerText.trim()) return
    setBusy(true)
    await supabase.from('copilot_qa_overrides').insert({ question_pattern: pattern.trim(), answer: answerText.trim(), language, active: true, created_by: userId })
    setBusy(false); setPattern(''); setAnswerText('')
    await load()
  }
  async function toggle(o: CopilotQaOverride) { await supabase.from('copilot_qa_overrides').update({ active: !o.active }).eq('id', o.id); await load() }
  async function remove(id: string) { await supabase.from('copilot_qa_overrides').delete().eq('id', id); await load() }

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <DashboardCard title="Add override">
        <p className="mb-3 text-[12px] text-emerald-900/55">Authoritative answers that bypass generation when the pattern matches (regex or plain text).</p>
        <div className="space-y-3">
          <div><Label htmlFor="ov_pat">Question pattern</Label><Input id="ov_pat" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="e.g. minimum export price" /></div>
          <div><Label htmlFor="ov_ans">Answer</Label><Textarea id="ov_ans" value={answerText} onChange={(e) => setAnswerText(e.target.value)} placeholder="The exact answer to return" /></div>
          <div><Label htmlFor="ov_lang">Language</Label>
            <Select id="ov_lang" value={language} onChange={(e) => setLanguage(e.target.value as 'en' | 'ha')}>
              <option value="en">English</option><option value="ha">Hausa (Kananci)</option>
            </Select>
          </div>
          <Button onClick={add} loading={busy} disabled={!pattern.trim() || !answerText.trim()}>Add override</Button>
        </div>
      </DashboardCard>

      <DashboardCard title="Overrides">
        {rows.length === 0 ? <p className="py-4 text-sm text-emerald-900/50">No overrides yet.</p> : (
          <ul className="divide-y divide-line">
            {rows.map((o) => (
              <li key={o.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-emerald-950">{o.question_pattern} <span className="text-[10px] uppercase text-emerald-900/40">{o.language}</span></p>
                  <p className="truncate text-[12px] text-emerald-900/55">{o.answer}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => toggle(o)}>{o.active ? 'Active' : 'Inactive'}</Button>
                  <button type="button" onClick={() => remove(o.id)} className="rounded p-1.5 text-emerald-900/35 hover:bg-red-50 hover:text-red-600" aria-label="Delete"><Trash2 className="h-4 w-4" aria-hidden /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DashboardCard>
    </div>
  )
}

// --- Flagged questions -------------------------------------------------------

function FlaggedTab() {
  const [rows, setRows] = useState<CopilotFlaggedQuestion[]>([])
  const [notes, setNotes] = useState<Record<string, string>>({})
  const load = useCallback(async () => {
    const { data } = await supabase.from('copilot_flagged_questions').select('*').order('asked_at', { ascending: false }).limit(200)
    setRows((data as CopilotFlaggedQuestion[]) ?? [])
  }, [])
  useEffect(() => { void load() }, [load])

  async function resolve(id: string) {
    await supabase.from('copilot_flagged_questions').update({ resolved: true, resolution_note: notes[id]?.trim() || null }).eq('id', id)
    await load()
  }

  const unresolved = rows.filter((r) => !r.resolved)
  return (
    <DashboardCard title={`Flagged questions (${unresolved.length} open)`}>
      <p className="mb-3 text-[12px] text-emerald-900/55">Questions the Co-pilot could not answer from data. Add an answer as a Q&amp;A override, then resolve here.</p>
      {rows.length === 0 ? <p className="py-4 text-sm text-emerald-900/50">Nothing flagged yet.</p> : (
        <ul className="divide-y divide-line">
          {rows.map((q) => (
            <li key={q.id} className="py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-emerald-950">{q.question} <span className="text-[10px] uppercase text-emerald-900/40">{q.language}</span></p>
                <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium', q.resolved ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>{q.resolved ? 'Resolved' : 'Open'}</span>
              </div>
              <p className="mt-0.5 text-[11px] text-emerald-900/45">{formatDateShort(q.asked_at)}{q.resolution_note ? ` · ${q.resolution_note}` : ''}</p>
              {!q.resolved && (
                <div className="mt-2 flex items-center gap-2">
                  <Input value={notes[q.id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [q.id]: e.target.value }))} placeholder="Resolution note (optional)" className="h-8 min-h-touch flex-1" />
                  <Button size="sm" onClick={() => resolve(q.id)}>Mark resolved</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  )
}

// --- Audit -------------------------------------------------------------------

function AuditTab() {
  const [rows, setRows] = useState<CopilotMessage[]>([])
  useEffect(() => {
    supabase.from('copilot_messages').select('*').eq('role', 'assistant').order('created_at', { ascending: false }).limit(80)
      .then(({ data }) => setRows((data as CopilotMessage[]) ?? []))
  }, [])

  return (
    <DashboardCard title="Answer audit">
      <p className="mb-3 text-[12px] text-emerald-900/55">Every Co-pilot answer with its provenance. Unanswered turns are the improvement loop.</p>
      {rows.length === 0 ? <p className="py-4 text-sm text-emerald-900/50">No answers recorded yet.</p> : (
        <ul className="divide-y divide-line">
          {rows.map((m) => {
            const sources = (m.data_sources ?? []).map((d) => d.source).filter(Boolean).join(', ')
            return (
              <li key={m.id} className="py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm text-emerald-950 line-clamp-2">{m.content}</p>
                  <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium', m.was_answered ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>{m.was_answered ? 'answered' : 'no data'}</span>
                </div>
                <p className="mt-1 text-[11px] text-emerald-900/45">
                  {formatDateShort(m.created_at)}
                  {m.data_as_of ? ` · data as of ${formatDateShort(m.data_as_of)}` : ''}
                  {sources ? ` · ${sources}` : ''}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </DashboardCard>
  )
}
