-- TEMPORARY TEST FIXTURE (reverted by the next migration): promotes ONE
-- disposable Stage 6 test account to admin for the final full-platform
-- regression. Scoped to a single exact test email.
update public.profiles
set role = 'admin'
where id = (
  select id from auth.users
  where email = 'usmanyakubu541+loamy6-admin-mrqfuwsb@gmail.com'
);
