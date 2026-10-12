import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LifeBuoy, SendHorizontal, WifiOff, X } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { cn, formatDateShort } from '@/lib/utils'
import { LoamAvatar, type LoamExpression } from '@/components/copilot/LoamAvatar'
import { askLoam, LoamUnavailable } from '@/lib/loam/transport'
import { VoiceInput } from '@/components/copilot/VoiceInput'
import { chatLanguageFor, type VoiceLanguage } from '@/lib/loam/voice'
import { describeSource, evidenceTone, suggestedPrompts, tone, ui } from '@/lib/loam/ui'
import {
  LOAM_LANGUAGES, isLoamLanguage, loamLanguageFromLocale, loamLanguageLabel,
} from '@/lib/loam/language'
import type { EvidenceLevel, LoamLanguage, RefusalKind } from '@/lib/loam/types'
import {
  appendLoamExchange, createConversation, latestConversation, loadMessages,
} from '@/lib/loam/conversations'

/**
 * THE assistant panel. There is only one, and it is Loam.
 *
 * WHAT THIS FILE USED TO BE
 *   A shared shell serving two assistants behind two flags: `loam` for the
 *   N-ATLaS path and `copilot` for the legacy keyword router. Every piece of
 *   copy, every affordance and the send handler itself branched on which one
 *   was active. A member could not tell which assistant they were talking to,
 *   and in practice people were answered by the legacy engine while reading
 *   Loam's name in the header.
 *
 *   The branch is gone. This component imports nothing from the legacy
 *   conversational engine -- not `answer`, not the phrase bank, not the voice
 *   clips, not the draft flow -- and `tests/unit/loam-boundaries.test.ts`
 *   enforces that. The legacy modules remain in the repository as a rollback
 *   and reference boundary; they are simply unreachable from the UI.
 *
 * WHAT THE FLAG DOES NOW
 *   `loam` decides whether the assistant appears at all. It is no longer a
 *   choice BETWEEN assistants, so `copilot` has no effect on anything a member
 *   can see. With `loam` off there is no assistant, which is the correct
 *   behaviour for an environment where Loam is not ready -- quieter, and far
 *   safer, than silently falling back to the engine Loam replaced.
 *
 * Every answer comes from POST /loam/chat, already gated and guarded on the
 * server. This component renders what it is given and makes no judgement about
 * whether an answer was safe to show.
 */

/**
 * The panel speaks every language Loam does.
 *
 * It used to be `'en' | 'ha'`, a narrowing inherited from the Co-pilot shell,
 * while the orchestrator, the classifier, the anchor table and `/loam/chat`
 * had all handled four languages for some time. So Igbo and Yoruba were
 * answerable and unreachable: the panel could neither offer them nor keep the
 * language when Loam detected one. `LoamLanguage` is the real type and the
 * panel now uses it directly.
 */

/** A rendered chat turn. */
interface ChatTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  dataAsOf?: string | null
  source?: string | null
  /** False when Loam declined. Drives the avatar's expression. */
  wasAnswered?: boolean
  /** The question that produced this answer. */
  userText?: string
  /**
   * The strongest evidence level backing this answer.
   *
   * `null` for a social turn, which carries no evidential claim at all. The
   * provenance chip renders only when a level is actually present -- a
   * greeting labelled "Not enough verified information" was a real bug.
   */
  level?: EvidenceLevel | null
  /** Why Loam declined, when it did. Decides the tone of the chip. */
  refusal?: RefusalKind
  /**
   * The model's own reasoning, held in its OWN field.
   *
   * Never concatenated into `content`. An earlier version put everything in
   * one string, which is how an unevidenced causal sentence came to sit beside
   * two grounded ones looking exactly like them. Separate fields make it
   * structurally impossible to render inference as though it were a record.
   */
  reasoning?: string[]
}

const CACHE_KEY = 'loamy_copilot_cache_v1'
const CACHE_TTL_MS = 7 * 864e5 // 7 days

function loadCache(): { turns: ChatTurn[]; dataAsOf: string | null } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { turns: ChatTurn[]; dataAsOf: string | null; savedAt: number }
    if (Date.now() - parsed.savedAt > CACHE_TTL_MS) return null
    return { turns: parsed.turns, dataAsOf: parsed.dataAsOf }
  } catch {
    return null
  }
}

function saveCache(turns: ChatTurn[], dataAsOf: string | null) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ turns, dataAsOf, savedAt: Date.now() }))
  } catch {
    /* storage full / disabled - non-fatal */
  }
}

export function Copilot() {
  const { profile, flagEnabled, languagePreference } = useAuth()
  const navigate = useNavigate()

  const [open, setOpen] = useState(false)
  /**
   * Seeded from the member's SAVED interface language, not from English.
   *
   * `languagePreference` is null when they have never chosen one, and
   * `loamLanguageFromLocale` resolves that -- and French, which Loam does not
   * answer in -- to English. Someone who set the platform to Hausa months ago
   * should not have to set it again on every first message.
   */
  const [language, setLanguage] = useState<LoamLanguage>(
    () => loamLanguageFromLocale(languagePreference),
  )
  /**
   * Declared before the effects, because the thread-resume effect needs it and
   * hooks must run before the gate below can return null.
   */
  const loamOn = flagEnabled('loam')
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [input, setInput] = useState('')
  /**
   * Whether what is in the composer came from the microphone rather than the
   * keyboard. Drives the "check it before sending" line: a transcript is a
   * guess about what somebody said and deserves a second look, which typed
   * text does not.
   */
  const [fromVoice, setFromVoice] = useState(false)
  const [sending, setSending] = useState(false)
  /**
   * Seconds the current question has been running.
   *
   * N-ATLaS answers in 30-100s on CPU. A spinner with no number reads as a
   * hang; a counting number reads as work in progress, which is what it is.
   */
  const [elapsed, setElapsed] = useState(0)
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [cachedAsOf, setCachedAsOf] = useState<string | null>(null)
  const [showDisclaimer, setShowDisclaimer] = useState(false)

  /**
   * What Loam is doing, derived from state the panel genuinely has.
   *
   *   thinking   a question is in flight
   *   concerned  the last answer was a decline
   *   happy      the last answer was a real one
   *
   * No timer drives this. The face changes because the conversation changed.
   */
  const lastAssistant = [...turns].reverse().find((t) => t.role === 'assistant')
  const loamExpression: LoamExpression =
    sending ? 'thinking'
    : lastAssistant?.wasAnswered === false ? 'concerned'
    : lastAssistant?.wasAnswered === true ? 'happy'
    : 'default'
  const conversationId = useRef<string | null>(null)
  const lastCommodity = useRef<string | undefined>(undefined)
  const scrollRef = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)

  // Online/offline listeners.
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  // Rehydrate the cached thread (offline continuity) once.
  useEffect(() => {
    const cache = loadCache()
    if (cache) {
      setTurns(cache.turns)
      setCachedAsOf(cache.dataAsOf)
    }
  }, [])

  // Disclaimer on first open of every session.
  useEffect(() => {
    if (open && !sessionStorage.getItem('loamy_copilot_disclaimer_seen')) {
      setShowDisclaimer(true)
      sessionStorage.setItem('loamy_copilot_disclaimer_seen', '1')
    }
  }, [open])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, open])

  // Count up while Loam is working; reset between questions.
  useEffect(() => {
    if (!sending) { setElapsed(0); return }
    const started = Date.now()
    const id = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(id)
  }, [sending])

  /**
   * Resume the member's thread when Loam is opened with nothing on screen.
   *
   * The localStorage cache already restores a thread within one browser; this
   * covers coming back on another device. Reuses `copilot_conversations` and
   * `copilot_messages` as they are - no new schema.
   */
  useEffect(() => {
    if (!open || !loamOn || !online || !profile || turns.length > 0) return
    let cancelled = false
    void (async () => {
      const cid = await latestConversation(profile.id)
      if (!cid || cancelled) return
      conversationId.current = cid
      const rows = await loadMessages(cid)
      if (cancelled || !rows.length) return
      setTurns(rows.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        dataAsOf: m.data_as_of,
        wasAnswered: m.was_answered,
        // Provenance is restored from what was stored; the model's separated
        // reasoning has no column and so does not come back. See
        // appendLoamExchange for why that is deliberate rather than forgotten.
        level: (m.data_sources as { level?: number }[] | null)?.[0]?.level as EvidenceLevel | undefined,
        source: ((m.data_sources as { source?: string }[] | null) ?? [])
          .map((d) => d.source).filter(Boolean).join('; ') || null,
      })))
    })()
    return () => { cancelled = true }
  }, [open, loamOn, online, profile, turns.length])

  /**
   * One gate, one assistant.
   *
   * `copilot` is deliberately not consulted: it no longer selects anything a
   * member can see, and reading it here would reintroduce the split.
   */
  if (!loamOn || !profile) return null

  async function send(preset?: string) {
    const text = (preset ?? input).trim()
    if (!text || sending || !online) return
    if (!preset) { setInput(''); setFromVoice(false) }
    const userTurn: ChatTurn = { id: crypto.randomUUID(), role: 'user', content: text }
    setTurns((t) => [...t, userTurn])
    setSending(true)
    try {
      const r = await askLoam({
        message: text,
        language,
        lastCommodity: lastCommodity.current ?? null,
      })
      if (r.commodity) lastCommodity.current = r.commodity
      /**
       * Keep the language Loam detected, whichever of the four it is.
       * Previously only en|ha were kept, so an Igbo question answered in Igbo
       * left the panel labelled English and the next turn asked in English.
       *
       * Superseded comment, kept for the reasoning:
       * which the panel cannot represent, so only the two it knows are pushed
       * back - the ANSWER is already in the right language either way, because
       * the server decided it.
       */
      if (isLoamLanguage(r.language) && r.language !== language) {
        setLanguage(r.language)
      }
      const asst: ChatTurn = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: r.answer,
        // The newest `asOf` across the evidence.
        dataAsOf: r.evidence.map((e) => e.asOf).filter(Boolean).sort().at(-1) ?? null,
        source: [...new Set(r.evidence.map((e) => e.source))].join('; ') || null,
        wasAnswered: !r.declined,
        userText: text,
        level: r.level,
        refusal: r.refusal,
        reasoning: r.reasoning ?? [],
      }
      const next = [...turns, userTurn, asst]
      setTurns(next)
      saveCache(next, asst.dataAsOf ?? cachedAsOf)
      if (asst.dataAsOf) setCachedAsOf(asst.dataAsOf)

      /**
       * Persist WITHOUT awaiting.
       *
       * This was awaited, and it cost ten seconds of dead UI: three round trips
       * ran before the enclosing `finally` could clear `sending`, so the answer
       * appeared on screen while the composer stayed disabled and "Loam is
       * thinking" kept spinning underneath it. Writing rows is not something
       * the member is waiting for.
       */
      void (async () => {
        try {
          if (!conversationId.current && profile) {
            conversationId.current = await createConversation(profile.id, r.language)
          }
          if (conversationId.current) {
            await appendLoamExchange(conversationId.current, text, r.answer, {
              sources: r.evidence.map((e) => ({ source: e.source, level: e.level })),
              asOf: asst.dataAsOf ?? null,
              answered: !r.declined,
            })
          }
        } catch {
          /* persistence is not worth losing the answer over */
        }
      })()
    } catch (e) {
      // A reachability failure is told plainly. No stack trace, no raw error.
      const msg = e instanceof LoamUnavailable ? e.message : ui('unreachable', language)
      setTurns((ts) => [...ts, {
        id: crypto.randomUUID(), role: 'assistant', content: msg,
        wasAnswered: false, userText: text,
      }])
    } finally {
      setSending(false)
    }
  }

  const escalate = () => {
    navigate(`/dashboard/${profile!.platform_role}/support`)
    setOpen(false)
  }

  const isStale = (asOf?: string | null) => Boolean(asOf) && Date.now() - Date.parse(asOf!) > 90 * 864e5

  return (
    <>
      {/* Floating launcher */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          // Sits ABOVE the mobile tab bar, not on top of it. At 390px the
          // launcher was covering the Intelligence and Profile tabs outright,
          // which is a navigation collision, not a z-index preference.
          // bottom-20 clears the 56px bar plus the safe area; from `lg` there
          // is no tab bar, so it returns to the corner.
          className="group fixed bottom-20 right-4 z-50 flex items-center gap-2.5 rounded-pill bg-brand-fill py-1.5 pl-1.5 pr-4 text-sm font-semibold text-white shadow-md ring-1 ring-inset ring-white/15 transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-bone motion-reduce:transition-none motion-reduce:hover:translate-y-0 lg:bottom-4"
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
          aria-label={ui('openLabel', language)}
          title={ui('openLabel', language)}
        >
          <LoamAvatar size={36} className="ring-white/40" />
          Ask Loam
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed inset-x-2 bottom-20 z-50 flex max-h-[70dvh] flex-col overflow-hidden rounded-card border border-clay bg-white shadow-lg sm:inset-x-auto sm:right-4 sm:w-[400px] lg:bottom-4">
          {/* Header */}
          <div className="flex items-center gap-2.5 border-b border-line bg-brand-fill px-3 py-2.5 text-white">
            <LoamAvatar size={32} expression={loamExpression} className="ring-white/30" />
            <div className="flex-1 leading-tight">
              <p className="text-sm font-semibold">{ui('title', language)}</p>
              <p className="text-[11px] text-white/70">{ui('subtitle', language)}</p>
            </div>
            {/*
              A select, not a cycling toggle. Two languages could be cycled;
              four cannot without making the fourth three taps away, and a
              native select is what a screen reader and a small touch target
              both handle best. Options carry each language's ENDONYM, because
              a selector that shows "Yoruba" to someone looking for "Yorùbá"
              is not a selector they can use.
            */}
            <label className="sr-only" htmlFor="loam-language">
              {ui('languageLabel', language)}
            </label>
            <select
              id="loam-language"
              value={language}
              onChange={(e) => setLanguage(e.target.value as LoamLanguage)}
              className="min-h-touch rounded border border-white/30 bg-transparent px-1 py-0.5 text-[11px] font-semibold tracking-wide text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              title={ui('languageLabel', language)}
            >
              {LOAM_LANGUAGES.map((l) => (
                // Dark text: the closed control is on the brand fill, but the
                // open list renders with the platform's own menu background.
                <option key={l} value={l} className="text-emerald-950">
                  {loamLanguageLabel(l)}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => setOpen(false)} className="rounded p-1 hover:bg-white/10" aria-label="Close">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>

          {/* Offline banner */}
          {!online && (
            <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
              <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Offline{cachedAsOf ? ` - showing data as of ${formatDateShort(cachedAsOf)}` : ''}. Reconnect to ask new questions.
            </div>
          )}

          {/* Thread */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {showDisclaimer && (
              <div className="rounded border border-line bg-surface p-2.5 text-[11px] leading-relaxed text-emerald-900/70">
                {ui('disclaimer', language)}
              </div>
            )}
            {turns.length === 0 && (
              <div className="pt-6 text-center text-[13px] text-emerald-900/55">
                <LoamAvatar size={48} className="mx-auto mb-2.5" />
                {ui('welcome', language)}
                {online && (
                  <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                    {suggestedPrompts(language).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => void send(s)}
                        className="rounded-full border border-line bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-800 transition-colors hover:bg-emerald-50"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {turns.map((t) => (
              <div key={t.id} className={cn('flex', t.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={cn('max-w-[85%] rounded px-3 py-2 text-sm', t.role === 'user' ? 'bg-emerald-800 text-white' : 'border border-line bg-surface text-emerald-950')}>
                  <p className="whitespace-pre-line leading-relaxed">{t.content}</p>

                  {/* The model's own reasoning, visually separated and labelled.
                      Rendered from its own field, so there is no code path that
                      can merge it into the factual answer above. */}
                  {t.role === 'assistant' && (t.reasoning?.length ?? 0) > 0 && (
                    <div className="mt-2 rounded border border-dashed border-amber-300 bg-amber-50/60 p-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                        {ui('reasoningLabel', language)}
                      </p>
                      <ul className="mt-1 space-y-1">
                        {t.reasoning!.map((line, i) => (
                          <li key={i} className="text-[12px] leading-relaxed text-amber-950/80">
                            {line}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* What this answer stands on, in product language. The
                      internal taxonomy (levels, grounding, anchors, polarity)
                      is mapped in src/lib/loam/ui.ts and never reaches here.
                      `!= null` also excludes social turns, which carry no
                      evidential claim - a greeting labelled "Not enough
                      verified information" was the bug that prompted it. */}
                  {t.role === 'assistant' && t.level != null && (() => {
                    const tn = evidenceTone(t.level, t.wasAnswered === false, t.refusal)
                    return (
                      <p className="mt-1.5 text-[10px]">
                        <span
                          className={cn(
                            'rounded-full px-1.5 py-0.5 font-medium',
                            tn === 'loamy' ? 'bg-emerald-100 text-emerald-800'
                              : tn === 'guidance' ? 'bg-sky-100 text-sky-800'
                              : tn === 'reasoned' ? 'bg-amber-100 text-amber-800'
                              // A deliberate boundary reads as a considered
                              // choice, not as the grey of a dead end.
                              : tn === 'policy' ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200'
                              : 'bg-emerald-950/5 text-emerald-900/55',
                          )}
                        >
                          {tone(tn, language)}
                        </span>
                      </p>
                    )
                  })()}

                  {/* Provenance footer, assembled from the parts that exist.
                      It used to print "Data as of -" whenever a turn had a
                      source but no date - a literal dash where a date should
                      be. A missing date is now simply absent. */}
                  {t.role === 'assistant' && (() => {
                    const bits = [
                      t.dataAsOf ? `Data as of ${formatDateShort(t.dataAsOf)}` : null,
                      // Internal attribution carries "PENDING AGRONOMIST
                      // REVIEW" so the status cannot be lost between the data
                      // and the screen. describeSource turns that into plain
                      // words WITHOUT dropping the caveat.
                      t.source
                        ? [...new Set(t.source.split('; ').map((x) => describeSource(x, language)))].join('; ')
                        : null,
                      isStale(t.dataAsOf) ? 'may be outdated' : null,
                    ].filter(Boolean)
                    if (!bits.length) return null
                    return (
                      <p className="mt-1.5 border-t border-line pt-1 text-[10px] text-emerald-900/45">
                        {bits.join(' · ')}
                      </p>
                    )
                  })()}
                </div>
              </div>
            ))}
            {sending && (
              <div
                className="flex items-start gap-2 rounded border border-line bg-surface px-2.5 py-2"
                role="status"
                aria-live="polite"
              >
                <LoamAvatar size={22} expression="thinking" className="mt-0.5 shrink-0" />
                <div className="leading-snug">
                  <p className="text-[12px] font-medium text-emerald-900/75">
                    {ui('thinking', language)}
                    {elapsed > 0 ? ` · ${elapsed}s` : '…'}
                  </p>
                  {/* Shown from the start, not after a delay: the wait is
                      expected, so explaining it up front is honest rather than
                      apologetic. */}
                  <p className="mt-0.5 text-[10px] text-emerald-900/45">
                    {ui('thinkingNote', language)}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-line p-2">
            <div className="flex items-end gap-1.5">
              <textarea
                value={input}
                onChange={(e) => { setInput(e.target.value); if (!e.target.value.trim()) setFromVoice(false) }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
                rows={1}
                placeholder={online ? ui('placeholder', language) : 'Offline'}
                disabled={!online || sending}
                ref={composer}
                className="max-h-24 flex-1 resize-none rounded border border-line px-2.5 py-1.5 text-sm text-emerald-950 placeholder:text-emerald-900/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50"
                aria-label={ui('composerLabel', language)}
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={!input.trim() || sending || !online}
                className="flex h-9 w-9 min-h-touch min-w-touch shrink-0 items-center justify-center rounded bg-emerald-800 text-white hover:bg-emerald-700 disabled:opacity-40"
                aria-label="Send"
              >
                <SendHorizontal className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <VoiceInput
              chatLanguage={language as VoiceLanguage}
              disabled={!online || sending}
              onTranscript={(text, spoken) => {
                /**
                 * Into the composer, never straight to Loam. The member reads
                 * it, fixes what the model misheard, and sends it themselves.
                 *
                 * Appended rather than replacing, so a transcript cannot
                 * silently destroy something already typed.
                 */
                setInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text))
                setFromVoice(true)
                // Answer in the language that was spoken. Pidgin narrows to
                // English -- `chatLanguageFor` is where that is written down.
                setLanguage(chatLanguageFor(spoken))
                // Focus and put the caret at the end, ready to edit.
                requestAnimationFrame(() => {
                  const el = composer.current
                  if (!el) return
                  el.focus()
                  el.selectionStart = el.selectionEnd = el.value.length
                })
              }}
            />

            {fromVoice && input.trim() && (
              <p className="mt-1.5 text-[10px] text-emerald-900/55" role="status">
                Transcribed on this device. Check it before sending.
              </p>
            )}

            {/* Escalation to a human. Not a Co-pilot response flow - a platform
                affordance that stays useful whatever the assistant can do. */}
            <div className="mt-2 flex items-center justify-between gap-2">
              <button type="button" onClick={escalate} className="flex items-center gap-1 text-[11px] font-medium text-emerald-700 hover:text-emerald-800">
                <LifeBuoy className="h-3.5 w-3.5" aria-hidden /> Talk to a Loamy agent
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
