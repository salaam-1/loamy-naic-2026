import { useState } from 'react'
import { Coins } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { AmountReferenceDialog } from '@/components/AmountReferenceDialog'

/**
 * Record the value a concluded marketplace deal SETTLED for off-platform.
 * Self-reported by a party; feeds platform GMV. Loamy records only — the money
 * moved between the parties on bank rails.
 */
export function RecordSettlement({ interestId, onDone }: { interestId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState(false)

  if (done) {
    return <span className="text-[11px] font-medium text-emerald-700">Settlement recorded</span>
  }
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Coins className="h-3.5 w-3.5" aria-hidden /> Record settled value
      </Button>
      <AmountReferenceDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Record settled value"
        amountLabel="Value this deal settled for"
        hint="As agreed off-platform. Loamy records only - the money moved on bank rails."
        submitLabel="Record settlement"
        onSubmit={async (gross, reference) => {
          const { error } = await supabase.rpc('loamy_record_marketplace_settlement', {
            p_interest: interestId,
            p_gross: gross,
            p_reference: reference,
          })
          if (error) throw new Error(error.message)
          setDone(true)
          onDone()
        }}
      />
    </>
  )
}
