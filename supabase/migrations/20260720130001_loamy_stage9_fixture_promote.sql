-- TEMPORARY fixture (reverted below): promote the Stage 9 test admin.
update public.profiles set role='admin' where id=(select id from auth.users where email='usmanyakubu541+loamy9-admin-mrt0chty@gmail.com');
