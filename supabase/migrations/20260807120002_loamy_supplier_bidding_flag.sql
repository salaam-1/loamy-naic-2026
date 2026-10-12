-- Seed the supplier_bidding flag (default OFF) so it appears in the admin
-- Feature-flags panel. Gates the supplier-side "Open Buy Requests" board.
update public.platform_config
set flags = jsonb_build_object('supplier_bidding', false) || coalesce(flags, '{}'::jsonb)
where id = 1;
