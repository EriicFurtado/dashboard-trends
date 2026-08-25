-- Client identity is the CRM external_id, not the display name.
alter table if exists public.clients
  drop constraint if exists clients_name_key_key;

create index if not exists clients_name_key_idx on public.clients(name_key);

insert into public.stages (name, sort_order) values
  ('Projeto', 8),
  ('Visita Técnica', 9)
on conflict (name) do update set sort_order = excluded.sort_order;
