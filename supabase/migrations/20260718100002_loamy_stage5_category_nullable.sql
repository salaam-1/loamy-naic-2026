-- DELIBERATE, DOCUMENTED portal-constraint relaxation (the one and only):
-- profiles.category becomes NULLABLE. Rationale: bank officers (and future
-- operational staff) are not agricultural participants — none of the 8
-- category labels applies to them. The portal's own signup always supplies a
-- category, so no portal write path is affected; the CHECK constraint on
-- allowed values remains fully intact. Flagged in the README for engineer
-- review.
alter table public.profiles alter column category drop not null;
