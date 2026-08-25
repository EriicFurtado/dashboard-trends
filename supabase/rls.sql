alter table public.clients enable row level security;
alter table public.service_types enable row level security;
alter table public.stages enable row level security;
alter table public.service_orders enable row level security;
alter table public.tasks enable row level security;
alter table public.migration_issues enable row level security;

revoke all on table public.clients from anon, authenticated;
revoke all on table public.service_types from anon, authenticated;
revoke all on table public.stages from anon, authenticated;
revoke all on table public.service_orders from anon, authenticated;
revoke all on table public.tasks from anon, authenticated;
revoke all on table public.migration_issues from anon, authenticated;

grant select on table public.clients to anon, authenticated;
grant select on table public.service_types to anon, authenticated;
grant select on table public.stages to anon, authenticated;
grant select on table public.service_orders to anon, authenticated;
grant select on table public.tasks to anon, authenticated;

drop policy if exists "authenticated read clients" on public.clients;
drop policy if exists "public read clients" on public.clients;
create policy "public read clients" on public.clients
  for select to anon, authenticated using (
    exists (
      select 1 from public.service_orders
      where service_orders.client_id = clients.id
        and lower(btrim(service_orders.occurrence)) = lower('Projeto Padrão')
    )
  );
drop policy if exists "authenticated read service types" on public.service_types;
drop policy if exists "public read service types" on public.service_types;
create policy "public read service types" on public.service_types
  for select to anon, authenticated using (true);
drop policy if exists "authenticated read stages" on public.stages;
drop policy if exists "public read stages" on public.stages;
create policy "public read stages" on public.stages
  for select to anon, authenticated using (true);
drop policy if exists "authenticated read service orders" on public.service_orders;
drop policy if exists "public read service orders" on public.service_orders;
create policy "public read service orders" on public.service_orders
  for select to anon, authenticated using (lower(btrim(occurrence)) = lower('Projeto Padrão'));
drop policy if exists "authenticated read tasks" on public.tasks;
drop policy if exists "public read tasks" on public.tasks;
create policy "public read tasks" on public.tasks
  for select to anon, authenticated using (
    exists (
      select 1 from public.service_orders
      where service_orders.id = tasks.service_order_id
        and lower(btrim(service_orders.occurrence)) = lower('Projeto Padrão')
    )
  );

-- migration_issues intentionally has no browser-facing policy. Administrative
-- migration credentials bypass RLS and must only be used in a trusted shell.
