-- ============================================================================
-- Loamy · Co-pilot v2 Part C — price context aggregation + concept knowledge base.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- loamy_copilot_price_context: everything the "is this a good price?" answer
-- needs, aggregated SERVER-SIDE (so it is not limited by the 1000-row request
-- cap). ONE price_type only (default retail). Observed history only — no
-- forecast. This is the backbone of the flagship comparison + seasonal calendar.
-- ---------------------------------------------------------------------------
-- SECURITY-REVIEW: never aggregates across price_type (the p_price_type filter
-- is mandatory). Reads only the active-batch price view; returns aggregates, no
-- row-level identity or PII.
create or replace function public.loamy_copilot_price_context(
  p_commodity text,
  p_state text default null,
  p_price_type text default 'retail'
) returns jsonb
language sql
stable
set search_path = public
as $$
  with base as (
    select h.date,
           h.price_ngn_per_kg::numeric as p,
           extract(month from h.date)::int as m,
           extract(year  from h.date)::int as y
    from public.loamy_copilot_prices h
    where lower(h.commodity) = lower(p_commodity)
      and h.price_type = p_price_type
      and (p_state is null or lower(h.state) = lower(p_state))
  ),
  monthly as (select m, avg(p) avg_p, count(*) n from base group by m),
  latest  as (select date, p from base order by date desc limit 1),
  curmonth as (
    select min(p) lo, max(p) hi, avg(p) av, count(distinct y) yrs
    from base where m = extract(month from now())::int
  ),
  span as (select min(y) miny, max(y) maxy, count(*) c from base)
  select case when (select c from span) = 0 then null else jsonb_build_object(
    'row_count',      (select c from span),
    'latest_date',    (select date from latest),
    'latest_per_kg',  (select round(p,2) from latest),
    'years_from',     (select miny from span),
    'years_to',       (select maxy from span),
    'cur_month',      extract(month from now())::int,
    'cur_month_low',  (select round(lo,2) from curmonth),
    'cur_month_high', (select round(hi,2) from curmonth),
    'cur_month_avg',  (select round(av,2) from curmonth),
    'cur_month_years',(select yrs from curmonth),
    'cheapest_month', (select m from monthly order by avg_p asc limit 1),
    'dearest_month',  (select m from monthly order by avg_p desc limit 1),
    'monthly',        (select jsonb_agg(jsonb_build_object('month',m,'avg',round(avg_p,2),'n',n) order by m) from monthly)
  ) end;
$$;

revoke all on function public.loamy_copilot_price_context(text, text, text) from public, anon;
grant execute on function public.loamy_copilot_price_context(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- copilot_concepts — admin-maintained explanations (EN + Hausa) the Co-pilot
-- returns verbatim for "what is X" questions. Never model knowledge.
-- ---------------------------------------------------------------------------
create table if not exists public.copilot_concepts (
  id        uuid primary key default gen_random_uuid(),
  topic     text not null,
  aliases   text[] not null default '{}',
  body_en   text not null,
  body_ha   text,
  active    boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists copilot_concepts_active_idx on public.copilot_concepts (active);

alter table public.copilot_concepts enable row level security;
drop policy if exists "loamy_concepts_select" on public.copilot_concepts;
create policy "loamy_concepts_select" on public.copilot_concepts for select to authenticated using (active or public.loamy_is_admin());
drop policy if exists "loamy_concepts_write_admin" on public.copilot_concepts;
create policy "loamy_concepts_write_admin" on public.copilot_concepts for all to authenticated using (public.loamy_is_admin()) with check (public.loamy_is_admin());

insert into public.copilot_concepts (topic, aliases, body_en, body_ha) values
  ('Digital ID', array['digital id','loamy id','digital identity'],
   'Your Loamy Digital ID is your permanent verified identity across the platform — it links your profile, farms and activity so banks and buyers can trust who you are. You never lose it, and it is yours across the whole Loamy ecosystem.',
   'Lambar Dijital ɗinka na Loamy ita ce shaidarka ta dindindin a ko’ina cikin dandalin — tana haɗa bayananka, gonakinka da ayyukanka domin bankuna da masu saya su amince da kai.'),
  ('Verification', array['verification','why verify','get verified','verified badge'],
   'Verification confirms your identity and, for sellers, that your farm and produce are real — a Growth Partner checks them on the ground. Verified members earn a badge buyers and banks trust. Loamy records the result; it never sees your BVN/NIN.',
   'Tabbatarwa tana tabbatar da ko wanene kai, kuma ga masu sayarwa, cewa gonakinka na gaske ne — abokin haɓaka yakan duba su a wurin. Membobin da aka tabbatar suna samun alama da masu saya da bankuna ke amincewa.'),
  ('Murabaha', array['murabaha','islamic finance','shariah finance','halal loan'],
   'Murabaha is a Shariah-compliant financing arrangement: instead of an interest-bearing loan, the bank buys the asset (e.g. inputs) and sells it to you at an agreed mark-up, paid in instalments. On Loamy, all financing decisions and the Murabaha contract are made by the partner bank — Loamy never lends.',
   'Murabaha wata hanya ce ta ba da tallafi bisa Shari’a: maimakon rance mai ruwa, banki yakan sayi kaya ya sayar maka da ƙari da aka amince, a biya a kashi-kashi. A Loamy, banki ne ke yanke duk shawarar tallafi — Loamy ba ya ba da rance.'),
  ('Escrow', array['escrow','is my money safe','payment protection'],
   'When you pay for an order on Loamy, the money is held in escrow by the licensed payment partner (Paystack) — not by Loamy — until you confirm you received the goods, then it is released to the seller. Loamy never holds your funds.',
   'Idan ka biya oda a Loamy, kuɗin yana kwance a wurin abokin biyan kuɗi mai lasisi (Paystack) — ba Loamy ba — har sai ka tabbatar ka karɓi kaya, sannan a saki wa mai sayarwa. Loamy ba ya riƙe kuɗinka.')
on conflict do nothing;
