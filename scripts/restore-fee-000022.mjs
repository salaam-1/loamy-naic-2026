/**
 * One-off: restore the verification_commission rule ended by accident on
 * 2026-09-21, through the authoritative loamy_restore_fee_rule RPC.
 * Captures the exact before/after state on both sides of the call.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { secret } from './_secrets.mjs'
const env=Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const sb=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false}})
const { error: authErr } = await sb.auth.signInWithPassword({email:'usmanyakubu541+admin-explore@gmail.com',password:secret('QA_PASSWORD_ADMIN')})
if (authErr) { console.error('admin sign-in failed:', authErr.message); process.exit(1) }

const snapshot = async (label) => {
  const { data: rules } = await sb.from('fee_schedules')
    .select('ref,id,scope,transaction_type,basis,value,payer,min_fee,max_fee,active,effective_from,effective_to,note,created_by,created_at')
    .eq('scope','verification_commission').order('created_at')
  const { count: earnings } = await sb.from('partner_earnings').select('id',{count:'exact',head:true})
  const { data: sums } = await sb.from('partner_earnings').select('amount')
  const total = (sums??[]).reduce((n,r)=>n+Number(r.amount),0)
  const probes = {}
  for (const t of ['farm_verification','farmer_verification','commodity_verification','batch_verification','loading_verification','market_price_collection']) {
    const { data } = await sb.rpc('loamy_resolve_fee',{p_scope:'verification_commission',p_amount:0,p_transaction_type:t})
    probes[t] = { resolved: data.resolved, fee: data.fee, ref: data.schedule_ref ?? null }
  }
  return { label, rules, earnings, total, probes }
}

const before = await snapshot('BEFORE')
console.log('=== BEFORE ===')
console.log('verification_commission rules:', before.rules.length)
for (const r of before.rules) console.log(' ', JSON.stringify({ref:r.ref,type:r.transaction_type,value:r.value,active:r.active,from:r.effective_from,to:r.effective_to,created_by:r.created_by}))
console.log('resolve probes:', JSON.stringify(before.probes,null,1))
console.log('partner_earnings rows:', before.earnings, 'total amount:', before.total)

const target = before.rules.find(r => r.ref === 'FEE-000022')
if (!target) { console.error('FEE-000022 not found'); process.exit(1) }
console.log('\nFEE-000022 FULL BEFORE:', JSON.stringify(target,null,1))

console.log('\n=== CALLING loamy_restore_fee_rule ===')
const { data: res, error } = await sb.rpc('loamy_restore_fee_rule', {
  p_rule_id: target.id,
  p_reason: 'Accidental deactivation through the Admin Fees UI on 2026-09-21 11:30:55. Not a pricing decision. Reinstates the Block 5 default rate unchanged.',
})
if (error) { console.error('RESTORE FAILED:', error.message, error.code); process.exit(1) }
console.log(JSON.stringify(res,null,1))

const after = await snapshot('AFTER')
console.log('\n=== AFTER ===')
console.log('verification_commission rules:', after.rules.length)
for (const r of after.rules) console.log(' ', JSON.stringify({ref:r.ref,type:r.transaction_type,value:r.value,active:r.active,from:r.effective_from,to:r.effective_to,created_by:r.created_by?'set':null}))
console.log('resolve probes:', JSON.stringify(after.probes,null,1))
console.log('partner_earnings rows:', after.earnings, 'total amount:', after.total)

const stillTarget = after.rules.find(r=>r.ref==='FEE-000022')
console.log('\nFEE-000022 FULL AFTER:', JSON.stringify(stillTarget,null,1))
console.log('\nFEE-000022 UNCHANGED BY RESTORE:', JSON.stringify(target)===JSON.stringify(stillTarget))
console.log('partner_earnings UNCHANGED:', before.earnings===after.earnings && before.total===after.total)
