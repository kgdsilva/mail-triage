-- Ops Perfection belongs in its own view.
--
-- `is_segregated` is what puts a company in its own tab in the master log instead of
-- mixed into the group-wide list. The seed sets it for OP; the seed does not run on
-- deploy, and every production script written since only ever touched names and
-- aliases — so whether OP carries the flag in production depends on how that database
-- was first populated, which is not a thing to leave to chance.
--
-- Set here, guarded on the group's slug and on the flag not already being true, so it
-- is a no-op on a database where it was already right. It is a display split and never
-- a permission: the "All" view stays available to everybody either way.
UPDATE entity e
SET is_segregated = true
FROM company_group g
WHERE e.company_group_id = g.id
  AND g.slug = 'colab'
  AND e.code = 'OP'
  AND e.is_segregated = false;
