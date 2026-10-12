-- ============================================================================
-- Service directory: full street address.
-- ----------------------------------------------------------------------------
-- Warehouse owners (and logistics providers) already record state + LGA; this
-- adds the free-text street address so a counterparty knows where the facility
-- actually is once contact has been exchanged.
--
-- SECURITY-REVIEW: service_directory is readable by any signed-in member (that
-- is the point of a directory), so `address` is a SEMI-PUBLIC field. It is the
-- BUSINESS premises address the owner chooses to publish — never a home
-- address, and it is NOT exposed to the anon role (no public view selects it).
-- Verify no future public/anon view adds this column.
-- ============================================================================

alter table public.service_directory
  add column if not exists address text;

comment on column public.service_directory.address is
  'Business/facility street address published by the owner. Visible to signed-in members only.';
