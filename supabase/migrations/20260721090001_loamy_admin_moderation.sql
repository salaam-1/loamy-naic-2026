-- ============================================================================
-- Super-admin moderation: remove/restore a marketplace listing (audited).
-- Admin already has SELECT/UPDATE on listings via RLS; this wraps moderation
-- in a security-definer function so every action is recorded in audit_events.
-- ============================================================================

create or replace function public.loamy_admin_moderate_listing(p_listing uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller uuid;
  v_new    text;
begin
  if not public.loamy_is_admin() then
    raise exception 'Admin only';
  end if;
  if p_action not in ('remove','restore','pause') then
    raise exception 'Invalid moderation action';
  end if;
  select seller_id into v_seller from public.listings where id = p_listing;
  if v_seller is null then
    raise exception 'Listing not found';
  end if;

  v_new := case p_action when 'remove' then 'expired' when 'pause' then 'paused' else 'active' end;
  update public.listings set status = v_new where id = p_listing;

  perform public.loamy_audit_internal('listing_' || p_action, 'listing', p_listing,
    jsonb_build_object('new_status', v_new, 'seller_id', v_seller));

  if p_action = 'remove' then
    perform public.loamy_create_notification_internal(
      v_seller, 'Listing removed by admin',
      'One of your marketplace listings was removed by the Loamy team for policy reasons. Contact support if you have questions.',
      'marketplace');
  end if;
end;
$$;

revoke all on function public.loamy_admin_moderate_listing(uuid, text) from public, anon;
grant execute on function public.loamy_admin_moderate_listing(uuid, text) to authenticated;
