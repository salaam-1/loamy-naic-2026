-- Reverts the temporary Stage 5 test fixture: the disposable test account
-- returns to 'member'. No test account retains admin access.
update public.profiles
set role = 'member'
where id = (
  select id from auth.users
  where email = 'usmanyakubu541+loamy5-admin-mrpmbwpe@gmail.com'
);
