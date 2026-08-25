-- Replace the sample IDs with the Everflow task IDs supplied for reviewed rows.
-- This is intentionally separate from the migration: run only after reviewing IDs.
update public.tasks
set classification_source = 'manual'
where external_id = any (array[
  -- 123456,
  -- 789012
]::bigint[])
returning id, external_id, classification_source;
