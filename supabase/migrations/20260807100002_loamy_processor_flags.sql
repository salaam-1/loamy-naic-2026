-- Seed the two Processor feature flags into platform_config so they appear in
-- the admin Feature-flags panel. Both default OFF:
--   processor_procurement — the buy-request → analytics suite (Parts 2–9)
--   processor_kyc         — identity verification surface (no write path yet)
-- Idempotent: only adds keys that are not already present.
update public.platform_config
set flags = jsonb_build_object('processor_procurement', false, 'processor_kyc', false) || coalesce(flags, '{}'::jsonb)
where id = 1;
