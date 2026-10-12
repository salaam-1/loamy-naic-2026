-- Reverts all Stage 8 test-admin fixtures: disposable test accounts return to
-- 'member'. Final state: no test account holds admin.
update public.profiles set role = 'member'
where id in (select id from auth.users where email like 'usmanyakubu541+loamy8-admin-%@gmail.com');
