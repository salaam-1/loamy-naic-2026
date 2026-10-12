-- Removes the temporary diagnostic view from the previous migration.
-- Findings (recorded here for history): profiles_category_check allows exactly
-- the 8 Title-case role labels ('Farmer', 'Trader', 'Exporter',
-- 'Warehouse Owner', 'Logistics Provider', 'Growth Partner', 'Input Supplier',
-- 'Buyer'); profiles_state_check uses 'FCT' (not 'FCT (Abuja)').
drop view if exists public.loamy_tmp_schema_probe;
