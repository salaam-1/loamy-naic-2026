-- ============================================================================
-- PHASE 12 — institutional / government access.
-- ----------------------------------------------------------------------------
-- Directive Part 26. Permissioned aggregate intelligence and traceability for
-- institutions, with the constraint stated twice in the directive:
--
--   "Government users must not automatically have access to private
--    financial/user information."
--   "Government access is NOT unrestricted."
--
-- So this phase is mostly a set of REFUSALS, and the shape reflects that:
--
--   * an institutional account is admin-created; nobody self-registers into it
--   * access is a set of explicit SCOPES, granted one at a time, each with an
--     expiry — not a role that implies everything
--   * every institutional query is AUDITED, including the ones that return
--     nothing
--   * aggregates are counts over regions. No names, no phone numbers, no
--     financial detail, no coordinates
--   * trace-by-ID returns the PUBLIC scope of a chain, the same as a browsing
--     member -- never the party scope
--
-- SECURITY-REVIEW ** STATE ACCESS TO CITIZEN DATA **
-- The risk here is not a bug, it is scope creep: an institution asking for
-- "just one more field" until the aggregate identifies individuals. Two
-- structural defences: a k-anonymity floor on every aggregate (regions with
-- fewer than the threshold are withheld, not rounded), and no join path from
-- any institutional view to profiles. Verify both before granting a real
-- institution access.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The role, and scoped grants.
-- ----------------------------------------------------------------------------
insert into public.loamy_platform_roles (slug, label, is_operational, sort_order)
values ('institution', 'Institutional Viewer', true, 11)
on conflict (slug) do nothing;

create table if not exists public.institutional_access (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  organisation text not null,
  -- One row per granted scope. No scope is implied by the role itself.
  scope        text not null check (scope in (
    'aggregate_production',   -- verified farms, hectares, commodity counts by region
    'aggregate_trade',        -- transaction volumes by region and commodity
    'aggregate_storage',      -- warehouse capacity and utilisation by region
    'trace_lookup'            -- resolve a batch ref to its PUBLIC chain
  )),
  -- Why this access exists. Recorded so it can be reviewed and revoked.
  lawful_basis text not null,
  granted_by   uuid not null references public.profiles (id) on delete restrict,
  granted_at   timestamptz not null default now(),
  expires_at   timestamptz,
  revoked_at   timestamptz,
  unique (user_id, scope)
);

create index if not exists inst_access_user_idx on public.institutional_access (user_id) where revoked_at is null;

alter table public.institutional_access enable row level security;

-- An institution may see its OWN grants (so it knows what it is entitled to)
-- and nothing else. Only admins write.
drop policy if exists "loamy_inst_access_select" on public.institutional_access;
create policy "loamy_inst_access_select"
  on public.institutional_access for select to authenticated
  using (user_id = auth.uid() or public.loamy_is_admin());

drop policy if exists "loamy_inst_access_write_admin" on public.institutional_access;
create policy "loamy_inst_access_write_admin"
  on public.institutional_access for all to authenticated
  using (public.loamy_is_admin()) with check (public.loamy_is_admin());

/** Does the caller currently hold this scope? */
create or replace function public.loamy_has_institutional_scope(p_scope text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.institutional_access a
    where a.user_id = auth.uid()
      and a.scope = p_scope
      and a.revoked_at is null
      and (a.expires_at is null or a.expires_at > now())
  );
$$;

grant execute on function public.loamy_has_institutional_scope(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Audit every institutional query, including empty ones.
-- ----------------------------------------------------------------------------
-- An institution learning that a region has NO activity is still a disclosure,
-- and a refused query is the most interesting thing to review later.
create or replace function public.loamy_log_institutional_query(
  p_scope text, p_query text, p_params jsonb, p_allowed boolean, p_row_count int
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_events (actor_id, actor_role, event_type, subject_type, detail)
  values (auth.uid(), 'institution', 'institutional_query', p_scope,
          jsonb_build_object('query', p_query, 'params', p_params,
                             'allowed', p_allowed, 'rows', p_row_count));
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Aggregates, with a k-anonymity floor.
-- ----------------------------------------------------------------------------
update public.platform_config
set settings = jsonb_build_object('institutional_min_group_size', 5) || coalesce(settings, '{}'::jsonb)
where id = 1;

/**
 * Verified agricultural activity by state.
 *
 * Regions below the minimum group size are WITHHELD entirely rather than
 * rounded or bucketed. Rounding a count of 1 still says someone is there;
 * withholding says nothing.
 */
create or replace function public.loamy_institutional_production()
returns table (
  state text, verified_farms bigint, total_hectares_declared numeric,
  commodities bigint, batches bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_min int;
  v_n   int := 0;
begin
  if not (public.loamy_has_institutional_scope('aggregate_production') or public.loamy_is_admin()) then
    perform public.loamy_log_institutional_query('aggregate_production', 'production', '{}'::jsonb, false, 0);
    raise exception 'This account does not hold the aggregate_production scope.';
  end if;

  select coalesce((settings->>'institutional_min_group_size')::int, 5)
    into v_min from public.platform_config where id = 1;

  return query
  select f.state,
         count(*) filter (where f.verification_status = 'verified')::bigint,
         round(sum(f.size_hectares), 1),
         count(distinct c.crop)::bigint,
         count(distinct b.id)::bigint
  from public.farms f
  left join public.crop_records c on c.farm_id = f.id
  left join public.commodity_batches b on b.farm_id = f.id
  group by f.state
  having count(distinct f.id) >= v_min;

  get diagnostics v_n = row_count;
  perform public.loamy_log_institutional_query('aggregate_production', 'production', '{}'::jsonb, true, v_n);
end;
$$;

grant execute on function public.loamy_institutional_production() to authenticated;

/** Trade volumes by state and commodity. No parties, no prices. */
create or replace function public.loamy_institutional_trade()
returns table (
  state text, commodity text, transactions bigint, total_quantity numeric, unit text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_min int;
  v_n   int := 0;
begin
  if not (public.loamy_has_institutional_scope('aggregate_trade') or public.loamy_is_admin()) then
    perform public.loamy_log_institutional_query('aggregate_trade', 'trade', '{}'::jsonb, false, 0);
    raise exception 'This account does not hold the aggregate_trade scope.';
  end if;

  select coalesce((settings->>'institutional_min_group_size')::int, 5)
    into v_min from public.platform_config where id = 1;

  return query
  select coalesce(b.origin_state, t.delivery_state) as state,
         t.commodity,
         count(*)::bigint,
         round(sum(t.quantity), 2),
         min(t.unit)
  from public.transactions t
  left join public.commodity_batches b on b.id = t.batch_id
  where t.status = 'completed'
  group by coalesce(b.origin_state, t.delivery_state), t.commodity
  -- Deliberately NOT sum of subtotal: value is commercial, volume is policy.
  having count(*) >= v_min;

  get diagnostics v_n = row_count;
  perform public.loamy_log_institutional_query('aggregate_trade', 'trade', '{}'::jsonb, true, v_n);
end;
$$;

grant execute on function public.loamy_institutional_trade() to authenticated;

/** Storage capacity and recorded intake by state. */
create or replace function public.loamy_institutional_storage()
returns table (
  state text, facilities bigint, capacity_tonnes numeric, receipts bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_min int;
  v_n   int := 0;
begin
  if not (public.loamy_has_institutional_scope('aggregate_storage') or public.loamy_is_admin()) then
    perform public.loamy_log_institutional_query('aggregate_storage', 'storage', '{}'::jsonb, false, 0);
    raise exception 'This account does not hold the aggregate_storage scope.';
  end if;

  select coalesce((settings->>'institutional_min_group_size')::int, 5)
    into v_min from public.platform_config where id = 1;

  return query
  select d.state, count(distinct d.id)::bigint,
         round(coalesce(sum(d.capacity_tonnes), 0), 1),
         count(r.id)::bigint
  from public.service_directory d
  left join public.warehouse_receipts r on r.facility_id = d.id
  where d.service_type = 'warehouse'
  group by d.state
  having count(distinct d.id) >= v_min;

  get diagnostics v_n = row_count;
  perform public.loamy_log_institutional_query('aggregate_storage', 'storage', '{}'::jsonb, true, v_n);
end;
$$;

grant execute on function public.loamy_institutional_storage() to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Trace lookup — the PUBLIC chain only, and always audited.
-- ----------------------------------------------------------------------------
/**
 * An institution resolving a batch ref gets exactly what a browsing member
 * would: commodity, origin state, verification status, the event spine. No
 * counterparties, no quantities, no prices, no farm identity.
 *
 * It does NOT reuse loamy_trace_scope's 'party' path. An institution is never
 * a party, and giving them one would be the scope creep this phase guards
 * against.
 */
create or replace function public.loamy_institutional_trace(p_ref text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_b        public.commodity_batches%rowtype;
  v_out      jsonb;
  v_rows     jsonb;
begin
  if not (public.loamy_has_institutional_scope('trace_lookup') or public.loamy_is_admin()) then
    perform public.loamy_log_institutional_query('trace_lookup', 'trace',
              jsonb_build_object('ref', p_ref), false, 0);
    raise exception 'This account does not hold the trace_lookup scope.';
  end if;

  select entity_id into v_batch_id from public.loamy_entity_refs
  where ref = upper(trim(p_ref)) and entity_type = 'commodity_batch';

  if v_batch_id is null then
    perform public.loamy_log_institutional_query('trace_lookup', 'trace',
              jsonb_build_object('ref', p_ref), true, 0);
    return jsonb_build_object('found', false, 'reason', 'no_such_reference');
  end if;

  select * into v_b from public.commodity_batches where id = v_batch_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'event', e.event_type, 'to', e.new_status, 'at', e.occurred_at)
           order by e.occurred_at), '[]'::jsonb)
    into v_rows
  from public.batch_events e where e.batch_id = v_batch_id;

  v_out := jsonb_build_object(
    'found', true,
    'scope', 'institutional',
    'batch', jsonb_build_object(
      'ref', v_b.ref,
      'commodity', v_b.commodity,
      'origin_state', v_b.origin_state,
      'origin_traced', v_b.origin_traced,
      'verification_status', v_b.verification_status,
      'status', v_b.status,
      'created_at', v_b.created_at),
    'events', v_rows);

  perform public.loamy_log_institutional_query('trace_lookup', 'trace',
            jsonb_build_object('ref', p_ref, 'batch', v_b.ref), true, 1);
  return v_out;
end;
$$;

grant execute on function public.loamy_institutional_trace(text) to authenticated;

comment on table public.institutional_access is
  'Scoped, expiring, admin-granted institutional access (directive Part 26). The role implies NOTHING; each scope is a separate grant with a recorded lawful basis.';
