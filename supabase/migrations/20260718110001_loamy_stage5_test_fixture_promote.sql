-- TEMPORARY TEST FIXTURE (reverted by the next migration): promotes ONE
-- disposable Stage 5 test account to admin so the full bank loop (officer
-- creation → pipeline → report → decision → monitoring) can be verified
-- end-to-end against the live project. Scoped to a single exact test email.
update public.profiles
set role = 'admin'
where id = (
  select id from auth.users
  where email = 'usmanyakubu541+loamy5-admin-mrpmbwpe@gmail.com'
);
