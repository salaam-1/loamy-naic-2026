import { useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import type { DirectoryEntry } from '@/lib/marketplace'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/**
 * Inline booking request against a directory entry. Dates + details only — no
 * payment, no amount. The owner accepts/declines; contact is exchanged on
 * acceptance and the arrangement concludes off-platform.
 */
export function BookingRequestForm({
  entry,
  onDone,
  onCancel,
}: {
  entry: DirectoryEntry
  onDone: () => void
  onCancel: () => void
}) {
  const { profile } = useAuth()
  const warehouse = entry.service_type === 'warehouse'
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [details, setDetails] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    setError(null)
    if (!startDate) return setError(warehouse ? 'Start date is required.' : 'Date is required.')
    if (warehouse && endDate && endDate < startDate) return setError('End date cannot be before the start date.')
    if (!details.trim()) return setError(warehouse ? 'Describe what you need stored.' : 'Describe the load and route.')
    setBusy(true)
    const { error: insErr } = await supabase.from('service_bookings').insert({
      directory_id: entry.id,
      booker_id: profile.id,
      service_type: entry.service_type,
      start_date: startDate,
      end_date: warehouse ? endDate || null : null,
      details: details.trim(),
    })
    setBusy(false)
    if (insErr) return setError(insErr.message)
    onDone()
  }

  return (
    <form onSubmit={submit} className="space-y-2" noValidate>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor={`sd-${entry.id}`}>{warehouse ? 'From' : 'Date'}</Label>
          <Input id={`sd-${entry.id}`} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        {warehouse && (
          <div>
            <Label htmlFor={`ed-${entry.id}`}>To</Label>
            <Input id={`ed-${entry.id}`} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        )}
      </div>
      <div>
        <Label htmlFor={`de-${entry.id}`}>Details</Label>
        <Textarea id={`de-${entry.id}`} value={details} onChange={(e) => setDetails(e.target.value)} placeholder={warehouse ? 'e.g. 50t maize, dry storage' : 'e.g. Kano → Lagos, 30t maize'} />
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" type="submit" loading={busy}>Send request</Button>
        <Button size="sm" type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}
