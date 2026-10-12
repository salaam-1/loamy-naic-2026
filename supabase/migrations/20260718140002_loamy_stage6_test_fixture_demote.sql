-- Reverts the Stage 6 test fixture: the disposable test account returns to
-- 'member'. Final state: NO test account holds admin access anywhere.
update public.profiles
set role = 'member'
where id = (
  select id from auth.users
  where email = 'usmanyakubu541+loamy6-admin-mrqfuwsb@gmail.com'
);
