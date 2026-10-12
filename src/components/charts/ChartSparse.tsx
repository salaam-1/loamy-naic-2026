/** The honest sparse state (SPARSE-DATA RULE): raw numbers as text, one muted
 * line. Never a chart drawn from fabricated, interpolated, or padded points. */
export function ChartSparse({ facts }: { facts: { label: string; value: string | number }[] }) {
  return (
    <div className="py-2">
      {facts.length > 0 && (
        <dl className="flex flex-wrap gap-x-5 gap-y-1">
          {facts.map((f) => (
            <div key={f.label} className="text-sm">
              <dt className="inline text-emerald-900/55">{f.label} </dt>
              <dd className="inline font-mono text-[13px] font-medium text-emerald-950">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-1 text-[11px] text-emerald-900/45">Chart appears as data accumulates.</p>
    </div>
  )
}
