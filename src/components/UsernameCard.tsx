import { useT } from '@/lib/i18n'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AtSign, Check, ExternalLink, Loader2, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { normaliseUsername, profilePath, validateUsername } from '@/lib/identity'

type Availability =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'ok' }
  | { state: 'no'; message: string }

const VISIBILITY = [
  { value: 'members', label: 'Signed-in members only', hint: 'The default. Other Loamy members can find you; the open internet cannot.', saved: 'Saved. Only signed-in Loamy members can see your profile.' },
  { value: 'public', label: 'Anyone, including signed-out visitors', hint: 'Best for sellers who want buyers to find them from a search engine.', saved: 'Saved. Anyone with the link can see your profile.' },
  { value: 'private', label: 'Nobody', hint: 'Your profile page is hidden. You can still trade.', saved: 'Saved. Your profile page is now hidden.' },
]

/**
 * Username + profile visibility, for Settings.
 *
 * The availability check runs against the server rather than guessing, because
 * only the server knows about reserved names and the 90-day quarantine on a
 * released handle. Local validation exists so the common mistakes answer
 * instantly.
 */
export function UsernameCard({
  current,
  currentVisibility,
  onSaved,
}: {
  current: string | null
  currentVisibility: string
  onSaved?: (username: string) => void
}) {
  const { t } = useT()
  const [value, setValue] = useState(current ?? '')
  const [avail, setAvail] = useState<Availability>({ state: 'idle' })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [visibility, setVisibility] = useState(currentVisibility)
  const timer = useRef<ReturnType<typeof setTimeout>>()

  const name = normaliseUsername(value)
  const unchanged = name === (current ?? '')

  useEffect(() => {
    clearTimeout(timer.current)
    setMessage(null)

    if (unchanged || name.length === 0) { setAvail({ state: 'idle' }); return }

    const local = validateUsername(name)
    if (!local.ok) { setAvail({ state: 'no', message: local.message }); return }

    setAvail({ state: 'checking' })
    timer.current = setTimeout(async () => {
      const { data } = await supabase.rpc('loamy_username_available', { p_username: name })
      const r = data as { available: boolean; message?: string } | null
      setAvail(r?.available
        ? { state: 'ok' }
        : { state: 'no', message: r?.message ?? 'That name is not available.' })
    }, 400)

    return () => clearTimeout(timer.current)
  }, [name, unchanged])

  async function save() {
    setSaving(true); setMessage(null)
    const { data, error } = await supabase.rpc('loamy_set_username', { p_username: name })
    setSaving(false)

    if (error) { setMessage(error.message); return }
    const r = data as { changed: boolean; message?: string; username?: string } | null
    if (!r?.changed) {
      setMessage(r?.message ?? 'That name could not be set.')
      return
    }
    setMessage(`Your handle is now @${r.username}.`)
    onSaved?.(r.username!)
  }

  async function saveVisibility(next: string) {
    const previous = visibility
    setVisibility(next)
    setMessage(null)
    const { error } = await supabase.auth.getUser().then(({ data }) =>
      supabase.from('profiles').update({ profile_visibility: next }).eq('id', data.user!.id))
    if (error) {
      // Put the control back. Leaving it on the value that failed to save is
      // how somebody believes their profile is private when it is not.
      setVisibility(previous)
      setMessage(`Could not change visibility: ${error.message}`)
      return
    }
    setMessage(VISIBILITY.find((v) => v.value === next)?.saved ?? 'Visibility updated.')
    onSaved?.(current ?? '')
  }

  return (
    <Card className="p-5">
      <h2 className="text-[15px] font-semibold tracking-tight text-emerald-950">Your public handle</h2>
      <p className="mt-0.5 text-[13px] text-emerald-900/60">
        How people find and link to you on Loamy. You can change it once every 30 days.
      </p>

      <div className="mt-3 space-y-1.5">
        <Label htmlFor="username">{t('settings.username')}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <AtSign
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-emerald-900/35"
              strokeWidth={1.5}
              aria-hidden
            />
            <input
              id="username"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="kano_maize"
              autoComplete="off"
              spellCheck={false}
              maxLength={30}
              aria-describedby="username-status"
              aria-invalid={avail.state === 'no'}
              className="h-10 min-h-touch w-full rounded-control border border-clay pl-8 pr-9 font-mono text-sm text-emerald-950 transition-colors placeholder:font-sans placeholder:text-emerald-900/35 focus-visible:border-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-bone"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2">
              {avail.state === 'checking' && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-900/40" strokeWidth={1.5} aria-hidden />
              )}
              {avail.state === 'ok' && (
                <Check className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2} aria-hidden />
              )}
              {avail.state === 'no' && (
                <X className="h-3.5 w-3.5 text-amber-600" strokeWidth={2} aria-hidden />
              )}
            </span>
          </div>

          <Button
            onClick={save}
            disabled={saving || unchanged || avail.state !== 'ok'}
            loading={saving}
          >
            {current ? 'Change' : 'Claim'}
          </Button>
        </div>

        <p id="username-status" className="min-h-[1.25rem] text-xs" aria-live="polite">
          {avail.state === 'no' && <span className="text-amber-700">{avail.message}</span>}
          {avail.state === 'ok' && <span className="text-emerald-700">@{name} is available.</span>}
          {avail.state === 'idle' && current && (
            <Link
              to={profilePath(current)}
              /* -my-2 py-2: the link is 15px of text, so the target was
                 15px. Padding lifts it without moving the status line. */
              className="-my-2.5 inline-flex items-center gap-1 rounded py-2.5 font-medium text-emerald-700 hover:text-emerald-800"
            >
              View your profile <ExternalLink className="h-3 w-3" strokeWidth={1.5} aria-hidden />
            </Link>
          )}
        </p>
      </div>

      <div className="mt-4 space-y-1.5 border-t border-clay pt-4">
        <Label htmlFor="visibility">{t('settings.whoCanSee')}</Label>
        <Select
          id="visibility"
          value={visibility}
          onChange={(e) => void saveVisibility(e.target.value)}
        >
          {VISIBILITY.map((v) => (
            <option key={v.value} value={v.value}>{v.label}</option>
          ))}
        </Select>
        <p className="text-[12px] text-emerald-900/55">
          {VISIBILITY.find((v) => v.value === visibility)?.hint}
        </p>
      </div>

      {message && (
        <p className="mt-4 border-t border-clay pt-3 text-[13px] text-emerald-800" role="status">
          {message}
        </p>
      )}
    </Card>
  )
}
