-- Reverts all Stage 9 test-admin fixtures to 'member'. No test account holds admin.
update public.profiles set role='member'
where id in (select id from auth.users where email like 'usmanyakubu541+loamy9-admin-%@gmail.com');
