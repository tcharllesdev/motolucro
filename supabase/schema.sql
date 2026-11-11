-- ============================================================================
-- SCHEMA SQL: MOTOLUCRO (SUPABASE POSTGRESQL)
-- Cole e execute este script no SQL Editor do seu projeto no Supabase
-- ============================================================================

-- 1. Configurações de Consumo e Combustível por Usuário
create table if not exists public.bike_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  bike_name text not null default 'Minha Moto (Tenere)',
  fuel_consumption_km_l numeric(10,2) not null default 30.00,
  fuel_price_per_liter numeric(10,2) not null default 5.89,
  updated_at timestamptz not null default now()
);

-- 2. Itens de Manutenção Preventiva / Desgaste por KM (Custos Fixos por KM)
create table if not exists public.maintenance_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  cost numeric(10,2) not null,
  duration_km numeric(10,2) not null check (duration_km > 0),
  created_at timestamptz not null default now()
);

-- 3. Registros Diários (KM Inicial, KM Final, Valor Obtido, Hora Início/Fim)
create table if not exists public.daily_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  log_date date not null,
  earnings numeric(10,2) not null default 0,
  km_start numeric(10,2) not null default 0,
  km_end numeric(10,2) not null default 0,
  km_total numeric(10,2) not null default 0,
  start_time text,
  end_time text,
  notes text,
  created_at timestamptz not null default now()
);

-- 4. Gastos Inesperados / Manutenções Avulsas (Imprevistos)
create table if not exists public.unexpected_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expense_date date not null,
  description text not null,
  amount numeric(10,2) not null,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) - Cada usuário vê e edita apenas seus próprios dados
-- ============================================================================

alter table public.bike_settings enable row level security;
alter table public.maintenance_items enable row level security;
alter table public.daily_logs enable row level security;
alter table public.unexpected_expenses enable row level security;

create policy "Users manage own bike_settings" on public.bike_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage own maintenance_items" on public.maintenance_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage own daily_logs" on public.daily_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage own unexpected_expenses" on public.unexpected_expenses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
