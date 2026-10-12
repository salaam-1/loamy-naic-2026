-- Register 'processor' in the roles reference table. profiles.platform_role is
-- a FK to loamy_platform_roles(slug), so without this row any processor signup
-- fails the foreign key (500 at auth). Idempotent.
insert into public.loamy_platform_roles (slug, label, sort_order) values
  ('processor', 'Processor', 9)
on conflict (slug) do nothing;
