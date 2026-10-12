-- TEMPORARY fixture (reverted below): promote the fresh Stage 8 admin account.
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'usmanyakubu541+loamy8-admin-mrsvo27p@gmail.com');
