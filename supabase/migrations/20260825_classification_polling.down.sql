drop function if exists public.upsert_polled_task(jsonb);
drop function if exists public.classification_priority(text);
drop table if exists public.classification_log;
alter table public.tasks drop constraint if exists tasks_classification_source_check;
alter table public.tasks drop column if exists everflow_raw_hash;
alter table public.tasks drop column if exists classification_source;
alter table public.service_orders drop column if exists everflow_raw_hash;
