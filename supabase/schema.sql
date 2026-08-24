create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  external_id text,
  name text not null check (btrim(name) <> ''),
  name_key text generated always as (lower(btrim(name))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clients_external_id_key unique (external_id),
  constraint clients_name_key_key unique (name_key)
);

create table if not exists public.service_types (
  code text primary key,
  name text not null unique,
  sort_order smallint not null unique,
  constraint service_types_code_check
    check (code in ('AUT', 'RED', 'SEG', 'AAV', 'FIN', 'ONB', 'VTE'))
);

create table if not exists public.stages (
  name text primary key,
  sort_order smallint not null unique
);

create table if not exists public.service_orders (
  id uuid primary key default gen_random_uuid(),
  external_id bigint not null unique,
  client_id uuid not null references public.clients(id)
    on update cascade on delete restrict,
  occurrence text,
  operational_service_type text,
  deadline_level text,
  status text not null check (btrim(status) <> ''),
  registered_on date,
  planned_start_on date,
  planned_end_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  external_id bigint not null unique,
  service_order_id uuid not null references public.service_orders(id)
    on update cascade on delete restrict,
  original_name text not null check (btrim(original_name) <> ''),
  name text not null check (btrim(name) <> ''),
  type_code text references public.service_types(code)
    on update cascade on delete restrict,
  stage text references public.stages(name)
    on update cascade on delete restrict,
  status text not null check (btrim(status) <> ''),
  planned_on date,
  started_on date,
  ended_on date,
  technician text,
  auxiliaries text[] not null default '{}',
  original_category text,
  occurrence text,
  management_type text,
  warranty boolean not null default false,
  original_duration_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_complete_classification_check check (
    (type_code is null and stage is null)
    or (type_code is not null and stage is not null)
  )
);

create table if not exists public.migration_issues (
  id bigint generated always as identity primary key,
  entity_type text not null check (entity_type in ('client', 'service_order', 'task')),
  external_id text not null,
  issue_code text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint migration_issues_natural_key unique (entity_type, external_id, issue_code)
);

create index if not exists service_orders_client_id_idx on public.service_orders(client_id);
create index if not exists service_orders_status_idx on public.service_orders(status);
create index if not exists service_orders_occurrence_idx on public.service_orders(occurrence);
create index if not exists tasks_service_order_id_idx on public.tasks(service_order_id);
create index if not exists tasks_type_stage_idx on public.tasks(type_code, stage);
create index if not exists tasks_status_idx on public.tasks(status);
create index if not exists tasks_planned_on_idx on public.tasks(planned_on);
create index if not exists migration_issues_code_idx on public.migration_issues(issue_code);

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at before update on public.clients
for each row execute function public.set_updated_at();
drop trigger if exists service_orders_set_updated_at on public.service_orders;
create trigger service_orders_set_updated_at before update on public.service_orders
for each row execute function public.set_updated_at();
drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at before update on public.tasks
for each row execute function public.set_updated_at();
drop trigger if exists migration_issues_set_updated_at on public.migration_issues;
create trigger migration_issues_set_updated_at before update on public.migration_issues
for each row execute function public.set_updated_at();

insert into public.service_types (code, name, sort_order) values
  ('AUT', 'Automação', 1),
  ('RED', 'Redes', 2),
  ('SEG', 'Segurança Eletrônica', 3),
  ('AAV', 'Áudio e Vídeo', 4),
  ('FIN', 'Financeiro', 5),
  ('ONB', 'Onboarding', 6),
  ('VTE', 'Visita Técnica', 7)
on conflict (code) do update set
  name = excluded.name,
  sort_order = excluded.sort_order;

insert into public.stages (name, sort_order) values
  ('1º Pagamento', 1),
  ('Compras de materiais', 2),
  ('Infraestrutura', 3),
  ('Pré-Configuração', 4),
  ('Instalação', 5),
  ('Configuração Final', 6),
  ('Treinamento', 7)
on conflict (name) do update set sort_order = excluded.sort_order;
