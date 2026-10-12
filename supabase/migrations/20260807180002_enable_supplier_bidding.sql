-- Turn ON the supplier "Open Buy Requests" board so suppliers (farmers, traders,
-- exporters, warehouse owners) can see and bid on processor RFQs. Reversible in
-- Admin → Config. (processor_procurement stays OFF; flip it to also expose the
-- logistics-provider / warehouse-owner / Growth-Partner participation boards.)
update public.platform_config
set flags = coalesce(flags, '{}'::jsonb) || '{"supplier_bidding": true}'::jsonb
where id = 1;
