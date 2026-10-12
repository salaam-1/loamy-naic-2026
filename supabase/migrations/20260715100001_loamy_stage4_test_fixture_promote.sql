-- TEMPORARY TEST FIXTURE (reverted by the next migration): promotes ONE
-- disposable Stage 4 test account to admin so the two-layer verification loop
-- (field partner gathers → admin approves) can be verified end-to-end
-- against the live project. Scoped to a single exact test email.
update public.profiles
set role = 'admin'
where id = (
  select id from auth.users
  where email = 'usmanyakubu541+loamy4-admin-mrlk3b11@gmail.com'
);
