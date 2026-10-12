-- ============================================================================
-- BLOCK 6 (c) — the seeded programme bypassed the ref registry.
-- ----------------------------------------------------------------------------
-- 150001 seeded the default programme with a LITERAL ref, 'RPG-000001',
-- instead of issuing one through loamy_register_ref. The registry and the
-- counter therefore knew nothing about it, so the first real programme an
-- administrator created asked for a ref, was handed RPG-000001, and collided:
--
--   duplicate key value violates unique constraint referral_programmes_ref_key
--
-- Which meant the referral programme could not be configured at all -- the
-- one thing directive 2 and 6 insist must not be hard-coded.
--
-- The fix is to put the seed row through the registry properly rather than to
-- special-case the collision. Every ref in Loamy comes from one counter; a
-- literal written past it is how two records end up with the same name.
-- ============================================================================

do $$
declare r record; v_ref text;
begin
  for r in
    select p.id
    from public.referral_programmes p
    left join public.loamy_entity_refs e
           on e.entity_type = 'referral_programme' and e.entity_id = p.id
    where e.ref is null
    order by p.created_at
  loop
    -- Clear the literal first, so the unique index cannot collide with the
    -- value the counter is about to issue.
    update public.referral_programmes set ref = null where id = r.id;

    v_ref := public.loamy_register_ref('referral_programme', r.id, 'RPG');

    update public.referral_programmes set ref = v_ref where id = r.id;
  end loop;
end $$;

-- Prove it: every programme now has a ref, and every ref is in the registry.
do $$
declare v_orphans int;
begin
  select count(*) into v_orphans
  from public.referral_programmes p
  left join public.loamy_entity_refs e
         on e.entity_type = 'referral_programme' and e.entity_id = p.id
  where e.ref is null or p.ref is null or p.ref <> e.ref;

  if v_orphans > 0 then
    raise exception 'Block 6: % referral programme(s) are still outside the ref registry.', v_orphans;
  end if;
end $$;
