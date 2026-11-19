-- ============================================================================
-- MIGRATION: 20261119000001_telegram_integration.sql
-- Projeto: MotoLucro (Supabase: acrpfisrulqqruwbfopz)
-- Objetivo: Tabelas para vinculação de conta ao Bot do Telegram, códigos
--           temporários de pareamento e idempotência de updates do webhook.
-- Características: 100% idempotente, menor privilégio e RLS ativo.
-- ============================================================================

-- 1. Vínculo permanente (1:1) entre usuário autenticado e chat do Telegram
create table if not exists public.telegram_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  telegram_user_id bigint unique not null,
  telegram_chat_id bigint unique not null,
  telegram_username text,
  telegram_first_name text,
  linked_at timestamptz not null default now()
);

-- 2. Códigos temporários de pareamento gerados no app (expiram em 10 minutos)
create table if not exists public.telegram_link_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code text unique not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_telegram_link_codes_user_created
  on public.telegram_link_codes (user_id, created_at desc);

-- 3. Controle de idempotência para retries do webhook do Telegram (uso exclusivo service_role)
create table if not exists public.telegram_processed_updates (
  update_id bigint primary key,
  processed_at timestamptz not null default now()
);

-- ============================================================================
-- PRIVILÉGIOS E ROW LEVEL SECURITY (RLS)
-- ============================================================================

alter table public.telegram_links enable row level security;
alter table public.telegram_link_codes enable row level security;
alter table public.telegram_processed_updates enable row level security;

revoke all on table public.telegram_links from public, anon, authenticated;
revoke all on table public.telegram_link_codes from public, anon, authenticated;
revoke all on table public.telegram_processed_updates from public, anon, authenticated;

-- Usuário autenticado pode apenas consultar e desvincular seu próprio Telegram;
-- criação/atualização do vínculo acontece apenas via Edge Function (service_role).
grant select, delete on table public.telegram_links to authenticated;

drop policy if exists "Users view own telegram_links" on public.telegram_links;
create policy "Users view own telegram_links" on public.telegram_links
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users delete own telegram_links" on public.telegram_links;
create policy "Users delete own telegram_links" on public.telegram_links
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- Usuário autenticado pode criar, consultar e limpar seus próprios códigos de pareamento
grant select, insert, delete on table public.telegram_link_codes to authenticated;

drop policy if exists "Users view own telegram_link_codes" on public.telegram_link_codes;
create policy "Users view own telegram_link_codes" on public.telegram_link_codes
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users insert own telegram_link_codes" on public.telegram_link_codes;
create policy "Users insert own telegram_link_codes" on public.telegram_link_codes
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete own telegram_link_codes" on public.telegram_link_codes;
create policy "Users delete own telegram_link_codes" on public.telegram_link_codes
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
