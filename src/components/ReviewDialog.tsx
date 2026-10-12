import { useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { reviewRefusal } from '@/lib/identity'
import { cn } from '@/lib/utils'

interface Eligibility {
  eligible: boolean
  reason?: string
  message?: string
  direction?: 'buyer_on_seller' | 'seller_on_buyer'
}

const FACETS = [
  { key: 'p_quality', label: 'Quality as described' },
  { key: 'p_communication', label: 'Communication' },
  { key: 'p_timeliness', label: 'Timeliness' },
] as const

/**
 * Leave a review on a concluded deal.
 *
 * Eligibility is asked of the server FIRST and the form is only rendered when
 * the answer is yes. Offering a button that will be refused, and explaining
 * why afterwards, is the same amount of information delivered later and worse.
 *
 * The copy states plainly that the review is public and anonymous, because a
 * member who assumed it was private would have written something different.
 */
export function ReviewDialog({
  transactionId,
  onDone,
}: {
  transactionId: string
  onDone?: () => void
}) {
  const [elig, setElig] = useState<Eligibility | null>(null)
  const [rating, setRating] = useState(0)
  const [facets, setFacets] = useState<Record<string, number>>({})
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase.rpc('loamy_can_review', { p_transaction_id: transactionId }).then(({ data }) => {
      if (!cancelled) setElig((data as Eligibility) ?? { eligible: false })
    })
    return () => { cancelled = true }
  }, [transactionId])

  async function submit() {
    setSaving(true); setResult(null)
    const { data, error } = await supabase.rpc('loamy_submit_review', {
      p_transaction_id: transactionId,
      p_rating: rating,
      p_comment: comment.trim() || null,
      p_quality: facets.p_quality ?? null,
      p_communication: facets.p_communication ?? null,
      p_timeliness: facets.p_timeliness ?? null,
    })
    setSaving(false)

    if (error) { setResult(error.message); return }
    const r = data as { submitted: boolean; message?: string; ref?: string } | null
    if (!r?.submitted) { setResult(r?.message ?? 'That review could not be saved.'); return }
    setResult(`Thank you - your review is published as ${r.ref}.`)
    onDone?.()
  }

  if (elig === null) {
    return <div className="h-16 animate-pulse rounded border border-line bg-white" aria-hidden />
  }

  if (!elig.eligible) {
    return (
      <Card className="p-4">
        <p className="text-sm text-emerald-900/65">
          {elig.message ?? reviewRefusal(elig.reason)}
        </p>
      </Card>
    )
  }

  const subject = elig.direction === 'buyer_on_seller' ? 'seller' : 'buyer'

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-emerald-950">Review this {subject}</h2>
      <p className="mt-0.5 text-xs text-emerald-900/60">
        Your review is public and shown anonymously - buyers see “Verified {subject === 'seller' ? 'buyer' : 'seller'}”,
        not your name. It cannot be deleted once posted, and the {subject} may reply once.
      </p>

      <div className="mt-3 space-y-3">
        <div>
          <Label>Overall</Label>
          <StarPicker value={rating} onChange={setRating} size="md" />
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          {FACETS.map((f) => (
            <div key={f.key}>
              <Label className="text-xs">{f.label}</Label>
              <StarPicker
                value={facets[f.key] ?? 0}
                onChange={(n) => setFacets((s) => ({ ...s, [f.key]: n }))}
              />
            </div>
          ))}
        </div>

        <div>
          <Label htmlFor="review-comment">Comment (optional)</Label>
          <Textarea
            id="review-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={1500}
            rows={3}
            placeholder="What was the stock like? Did it match the listing?"
          />
          <p className="mt-0.5 text-right text-[11px] text-emerald-900/40">{comment.length}/1500</p>
        </div>

        <Button onClick={submit} disabled={saving || rating < 1} loading={saving}>
          Post review
        </Button>

        {result && (
          <p className="text-xs text-emerald-900/70" role="status">{result}</p>
        )}
      </div>
    </Card>
  )
}

function StarPicker({
  value,
  onChange,
  size = 'sm',
}: {
  value: number
  onChange: (n: number) => void
  size?: 'sm' | 'md'
}) {
  const px = size === 'md' ? 'h-6 w-6' : 'h-4 w-4'
  return (
    <div className="mt-0.5 flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          onClick={() => onChange(i)}
          aria-label={`${i} star${i === 1 ? '' : 's'}`}
          aria-pressed={value === i}
          className="rounded p-0.5 hover:bg-emerald-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-700"
        >
          <Star
            className={cn(px, i <= value ? 'fill-gold-400 text-gold-400' : 'text-emerald-900/25')}
            strokeWidth={1.5}
            aria-hidden
          />
        </button>
      ))}
    </div>
  )
}
