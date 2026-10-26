-- Categories taken from the mail that actually arrives.
--
-- Additive only: seven rows inserted, nothing dropped, renamed or deactivated. Any
-- document already pointing at an existing category keeps pointing at it.
--
-- Why: the seeded list was Technology, Legal, Insurance, Marketing, Office/Rent,
-- Utilities, Other — a software company's expense list. This office's mail is state and
-- federal tax notices, unemployment and payroll agencies, title and settlement
-- companies, banks, collections and tolls. Asked to file that mail under that list, the
-- reader answered "Other" nearly every time, and it was right to: none of the other six
-- fit. The categories were wrong, not the reading.
--
-- Each name below is here because documents in the log are addressed from these senders:
--
--   Taxes - federal           Internal Revenue Service
--   Taxes - state & local     Pennsylvania / Florida Departments of Revenue,
--                             Berkheimer Tax Innovations
--   Payroll & unemployment    Texas Workforce Commission, Colorado FAMLI,
--                             PA Dept of Labor (UC), Departamento del Trabajo de PR
--   Title & settlement        Laurel Settlement Group, Riverway Title, Capital Title of
--                             Texas, Old Republic Title, JMG Real Estate Escrow
--   Banking & loans           Marquette Savings Bank, Capital One Business,
--                             Munar Mortgage
--   Collections               The CBE Group, CAEDD offset collections
--   Tolls & vehicle           Tolls by Mail (MTA / Port Authority NY NJ / NYSTA)
--
-- Sort order leaves gaps between the existing values so these interleave by weight
-- rather than being appended after "Other", which would read as an afterthought.

INSERT INTO "category" (id, company_group_id, name, sort_order, is_active)
SELECT gen_random_uuid()::text, g.id, v.name, v.ord, true
FROM company_group g
CROSS JOIN (VALUES
  ('Taxes - federal', 11),
  ('Taxes - state & local', 12),
  ('Payroll & unemployment', 13),
  ('Title & settlement', 14),
  ('Banking & loans', 15),
  ('Collections', 16),
  ('Tolls & vehicle', 17)
) AS v(name, ord)
ON CONFLICT (company_group_id, name) DO NOTHING;
