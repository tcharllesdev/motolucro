-- ============================================================================
-- MIGRATION: 20261118000001_onda1_base_seguranca.sql
-- Projeto: MotoLucro (Supabase: acrpfisrulqqruwbfopz)
-- Objetivo: Hardening de privilégios, otimização de políticas RLS (initPlan)
--           e criação de índices compostos para FKs e ordenações principais.
-- Características: 100% idempotente, sem alteração destrutiva e ZERO perda de dados.
-- ============================================================================

-- 1. Garantir RLS habilitado nas 4 tabelas
alter table public.bike_settings enable row level security;
alter table public.maintenance_items enable row level security;
alter table public.daily_logs enable row level security;
alter table public.unexpected_expenses enable row level security;

-- 2. Privilégios mínimos (revoga GRANT ALL / TRUNCATE / TRIGGER / REFERENCES / MAINTAIN)
-- Mantém intactos os privilégios de postgres e service_role.
revoke all on table public.bike_settings from public, anon, authenticated;
revoke all on table public.maintenance_items from public, anon, authenticated;
revoke all on table public.daily_logs from public, anon, authenticated;
revoke all on table public.unexpected_expenses from public, anon, authenticated;

-- Concede exclusivamente CRUD (SELECT, INSERT, UPDATE, DELETE) para authenticated;
-- nenhum privilégio de tabela para anon.
grant select, insert, update, delete on table public.bike_settings to authenticated;
grant select, insert, update, delete on table public.maintenance_items to authenticated;
grant select, insert, update, delete on table public.daily_logs to authenticated;
grant select, insert, update, delete on table public.unexpected_expenses to authenticated;

-- 3. Recriar políticas RLS com TO authenticated e (select auth.uid()) = user_id
drop policy if exists "Users manage own bike_settings" on public.bike_settings;
create policy "Users manage own bike_settings" on public.bike_settings
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage own maintenance_items" on public.maintenance_items;
create policy "Users manage own maintenance_items" on public.maintenance_items
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage own daily_logs" on public.daily_logs;
create policy "Users manage own daily_logs" on public.daily_logs
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage own unexpected_expenses" on public.unexpected_expenses;
create policy "Users manage own unexpected_expenses" on public.unexpected_expenses
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- 4. Índices compostos para FKs (user_id) e ordenações principais do app
create index if not exists idx_daily_logs_user_date
  on public.daily_logs (user_id, log_date desc);

create index if not exists idx_maintenance_items_user_created
  on public.maintenance_items (user_id, created_at asc);

create index if not exists idx_unexpected_expenses_user_date
  on public.unexpected_expenses (user_id, expense_date desc);
