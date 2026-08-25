-- Incremental, reversible via 20260825_classification_polling.down.sql.
alter table public.tasks
  add column if not exists classification_source text not null default 'everflow_raw',
  add column if not exists everflow_raw_hash text;

alter table public.tasks drop constraint if exists tasks_classification_source_check;
alter table public.tasks add constraint tasks_classification_source_check
  check (classification_source in ('everflow_raw', 'llm_normalized', 'manual'));

alter table public.service_orders add column if not exists everflow_raw_hash text;

create table if not exists public.classification_log (
  id bigint generated always as identity primary key,
  task_id uuid references public.tasks(id) on update cascade on delete set null,
  task_external_id bigint not null,
  everflow_value jsonb not null default '{}'::jsonb,
  llm_value jsonb,
  validation_passed boolean not null,
  validation_errors jsonb not null default '[]'::jsonb,
  previous_source text,
  incoming_source text not null check (incoming_source in ('everflow_raw', 'llm_normalized', 'manual')),
  written boolean not null,
  decision text not null,
  created_at timestamptz not null default now()
);

create index if not exists classification_log_task_external_id_idx
  on public.classification_log(task_external_id, created_at desc);

alter table public.classification_log enable row level security;
revoke all on table public.classification_log from anon, authenticated;

create or replace function public.classification_priority(value text)
returns smallint language sql immutable strict set search_path = '' as $$
  select case value
    when 'everflow_raw' then 1::smallint
    when 'llm_normalized' then 2::smallint
    when 'manual' then 3::smallint
    else 0::smallint
  end
$$;

-- One atomic database boundary for operational updates, classification priority,
-- validation issues and the audit trail. Intended for the service-role only.
create or replace function public.upsert_polled_task(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_row public.tasks%rowtype;
  saved_row public.tasks%rowtype;
  incoming_source text := coalesce(payload->>'classification_source', 'llm_normalized');
  validation_ok boolean := coalesce((payload->>'validation_passed')::boolean, false);
  may_classify boolean;
  decision_text text;
begin
  if incoming_source not in ('everflow_raw', 'llm_normalized', 'manual') then
    raise exception 'invalid classification_source: %', incoming_source;
  end if;

  select * into current_row from public.tasks
  where external_id = (payload->>'external_id')::bigint for update;

  may_classify := validation_ok and (
    current_row.id is null or (
      current_row.classification_source <> 'manual'
      and public.classification_priority(incoming_source) >= public.classification_priority(current_row.classification_source)
    )
  );
  decision_text := case
    when not validation_ok then 'discarded_validation'
    when current_row.classification_source = 'manual' then 'discarded_manual_lock'
    when may_classify then 'written'
    else 'discarded_lower_priority'
  end;

  insert into public.tasks (
    external_id, service_order_id, original_name, name, type_code, stage,
    status, planned_on, started_on, ended_on, technician, original_category,
    occurrence, management_type, classification_source, everflow_raw_hash
  ) values (
    (payload->>'external_id')::bigint, (payload->>'service_order_id')::uuid,
    payload->>'original_name', payload->>'name',
    case when may_classify then nullif(payload#>>'{normalized,type_code}', '') else null end,
    case when may_classify then nullif(payload#>>'{normalized,stage}', '') else null end,
    payload->>'status', nullif(payload->>'planned_on', '')::date,
    nullif(payload->>'started_on', '')::date, nullif(payload->>'ended_on', '')::date,
    nullif(payload->>'technician', ''),
    case when may_classify then nullif(payload#>>'{normalized,original_category}', '') else null end,
    case when may_classify then nullif(payload#>>'{normalized,occurrence}', '') else null end,
    case when may_classify then nullif(payload#>>'{normalized,management_type}', '') else null end,
    case when may_classify then incoming_source else 'everflow_raw' end,
    payload->>'everflow_raw_hash'
  )
  on conflict (external_id) do update set
    service_order_id = excluded.service_order_id,
    original_name = excluded.original_name,
    name = excluded.name,
    status = excluded.status,
    planned_on = excluded.planned_on,
    started_on = excluded.started_on,
    ended_on = excluded.ended_on,
    technician = excluded.technician,
    everflow_raw_hash = excluded.everflow_raw_hash,
    type_code = case when may_classify then excluded.type_code else tasks.type_code end,
    stage = case when may_classify then excluded.stage else tasks.stage end,
    original_category = case when may_classify then excluded.original_category else tasks.original_category end,
    occurrence = case when may_classify then excluded.occurrence else tasks.occurrence end,
    management_type = case when may_classify then excluded.management_type else tasks.management_type end,
    classification_source = case when may_classify then incoming_source else tasks.classification_source end
  returning * into saved_row;

  if not validation_ok then
    insert into public.migration_issues(entity_type, external_id, issue_code, details)
    values ('task', payload->>'external_id', 'LLM_VALIDATION_FAILED',
      jsonb_build_object('errors', coalesce(payload->'validation_errors', '[]'::jsonb), 'llm', payload->'normalized'))
    on conflict (entity_type, external_id, issue_code) do update
      set details = excluded.details, updated_at = now();
  end if;

  insert into public.classification_log(
    task_id, task_external_id, everflow_value, llm_value, validation_passed,
    validation_errors, previous_source, incoming_source, written, decision
  ) values (
    saved_row.id, saved_row.external_id, coalesce(payload->'raw_classification', '{}'::jsonb),
    payload->'normalized', validation_ok, coalesce(payload->'validation_errors', '[]'::jsonb),
    current_row.classification_source, incoming_source, may_classify, decision_text
  );

  return jsonb_build_object('id', saved_row.id, 'external_id', saved_row.external_id,
    'written', may_classify, 'decision', decision_text, 'classification_source', saved_row.classification_source);
end;
$$;

revoke all on function public.upsert_polled_task(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_polled_task(jsonb) to service_role;
