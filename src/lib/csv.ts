import { supabase } from '@/lib/supabase'

/** Build + download a CSV client-side and audit-log the export (admin only). */
export async function downloadCsv(
  kind: string,
  headers: string[],
  rows: (string | number | boolean | null | undefined)[][],
) {
  const escape = (v: string | number | boolean | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
  }
  const csv = [headers, ...rows].map((r) => r.map(escape).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `loamy-${kind}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
  await supabase.rpc('loamy_admin_log_export', { p_kind: kind, p_rows: rows.length })
}
