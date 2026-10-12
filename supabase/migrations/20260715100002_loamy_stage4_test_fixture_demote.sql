-- Reverts the temporary Stage 4 test fixture: the disposable test account
-- returns to 'member'. No test account retains admin access.
update public.profiles
set role = 'member'
where id = (
  select id from auth.users
  where email = 'usmanyakubu541+loamy4-admin-mrlk3b11@gmail.com'
);
