-- Dedicated super-admin EXPLORE account for the owner to review the admin
-- dashboard. Persistent (not a test fixture). Delete before public launch:
--   delete the auth user usmanyakubu541+admin-explore@gmail.com in Supabase.
update public.profiles set role='admin'
where id=(select id from auth.users where email='usmanyakubu541+admin-explore@gmail.com');
