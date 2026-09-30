-- Data source for the project-label mail merge (project-labels-template.docx).
-- Run in the Supabase SQL editor, then "Download CSV" and save it as
-- project-labels.csv next to the template.
--
-- Covers both saumaklúbbur and maintenance projects (one `maintenance`
-- table, split by the `saumaklubbur` flag). Only open (unresolved)
-- projects with a non-empty description; saumaklúbbur first, then
-- maintenance, oldest first within each.
select trim(description) as "Description"
from maintenance
where not resolved
  and coalesce(trim(description), '') <> ''
order by coalesce(saumaklubbur, false) desc, created_at;
