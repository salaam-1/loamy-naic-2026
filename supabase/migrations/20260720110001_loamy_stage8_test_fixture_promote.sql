-- TEMPORARY TEST FIXTURE (reverted by the next migration): promotes one
-- disposable Stage 8 test account to admin to verify platform-metrics access.
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'usmanyakubu541+loamy8-admin-mrsvl6sz@gmail.com');
