import React, { useState, useEffect, useMemo } from 'react';
import {
  Bike,
  PlusCircle,
  Wrench,
  Fuel,
  AlertTriangle,
  History,
  Cloud,
  Trash2,
  Clock,
  TrendingUp,
  DollarSign,
  Gauge,
  CheckCircle2,
  LogOut,
  LogIn,
  UploadCloud,
  Download,
  Copy,
  Check,
  Calendar,
} from 'lucide-react';
import { BikeSettings, MaintenanceItem, DailyLog, UnexpectedExpense } from './types';
import {
  DEFAULT_BIKE_SETTINGS,
  DEFAULT_MAINTENANCE_ITEMS,
  DEFAULT_UNEXPECTED_EXPENSES,
  SEED_DAILY_LOGS,
} from './seedData';
import {
  calcFuelCostPerKm,
  calcMaintenanceCostPerKm,
  calculateDayMetrics,
  formatBRL,
  formatPerKm,
  formatDateBR,
  calcHoursWorked,
} from './calculations';
import {
  getSupabaseClient,
  getSupabaseCredentials,
  saveSupabaseCredentials,
  clearSupabaseCredentials,
} from './supabaseClient';

const LS_SETTINGS_KEY = 'motolucro_bike_settings_v1';
const LS_MAINT_KEY = 'motolucro_maint_items_v1';
const LS_LOGS_KEY = 'motolucro_daily_logs_v1';
const LS_UNEXPECTED_KEY = 'motolucro_unexpected_v1';

const SQL_SCHEMA_TEXT = `-- Cole no SQL Editor do Supabase e clique em Run:
create table if not exists public.bike_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  bike_name text not null default 'Minha Moto (Tenere)',
  fuel_consumption_km_l numeric(10,2) not null default 30.00,
  fuel_price_per_liter numeric(10,2) not null default 5.89,
  updated_at timestamptz not null default now()
);

create table if not exists public.maintenance_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  cost numeric(10,2) not null,
  duration_km numeric(10,2) not null check (duration_km > 0),
  created_at timestamptz not null default now()
);

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

create table if not exists public.unexpected_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expense_date date not null,
  description text not null,
  amount numeric(10,2) not null,
  created_at timestamptz not null default now()
);

alter table public.bike_settings enable row level security;
alter table public.maintenance_items enable row level security;
alter table public.daily_logs enable row level security;
alter table public.unexpected_expenses enable row level security;

create policy "Users manage own bike_settings" on public.bike_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own maintenance_items" on public.maintenance_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own daily_logs" on public.daily_logs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own unexpected_expenses" on public.unexpected_expenses for all using (auth.uid() = user_id) with check (auth.uid() = user_id);`;

type TabType = 'lancar' | 'historico' | 'custos' | 'imprevistos' | 'nuvem';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('lancar');

  // Estado principal (com fallback imediato para LocalStorage + Planilha Inicial)
  const [settings, setSettings] = useState<BikeSettings>(() => {
    const saved = localStorage.getItem(LS_SETTINGS_KEY);
    return saved ? JSON.parse(saved) : DEFAULT_BIKE_SETTINGS;
  });

  const [maintenanceItems, setMaintenanceItems] = useState<MaintenanceItem[]>(() => {
    const saved = localStorage.getItem(LS_MAINT_KEY);
    return saved ? JSON.parse(saved) : DEFAULT_MAINTENANCE_ITEMS;
  });

  const [dailyLogs, setDailyLogs] = useState<DailyLog[]>(() => {
    const saved = localStorage.getItem(LS_LOGS_KEY);
    return saved ? JSON.parse(saved) : SEED_DAILY_LOGS;
  });

  const [unexpectedExpenses, setUnexpectedExpenses] = useState<UnexpectedExpense[]>(() => {
    const saved = localStorage.getItem(LS_UNEXPECTED_KEY);
    return saved ? JSON.parse(saved) : DEFAULT_UNEXPECTED_EXPENSES;
  });

  // Persistência local automática a cada mudança
  useEffect(() => {
    localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem(LS_MAINT_KEY, JSON.stringify(maintenanceItems));
  }, [maintenanceItems]);

  useEffect(() => {
    localStorage.setItem(LS_LOGS_KEY, JSON.stringify(dailyLogs));
  }, [dailyLogs]);

  useEffect(() => {
    localStorage.setItem(LS_UNEXPECTED_KEY, JSON.stringify(unexpectedExpenses));
  }, [unexpectedExpenses]);

  // Estado de Autenticação Supabase
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [authEmailInput, setAuthEmailInput] = useState('');
  const [authPasswordInput, setAuthPasswordInput] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authStatus, setAuthStatus] = useState<string>('');
  const [syncing, setSyncing] = useState(false);

  // Credenciais dinâmicas do Supabase
  const initialCreds = getSupabaseCredentials();
  const [sbUrlInput, setSbUrlInput] = useState(initialCreds.url);
  const [sbKeyInput, setSbKeyInput] = useState(initialCreds.anonKey);
  const [isSbConfigured, setIsSbConfigured] = useState(initialCreds.isConfigured);
  const [copiedSql, setCopiedSql] = useState(false);

  // Checar sessão do Supabase ao carregar
  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) return;

    client.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        setUserEmail(data.session.user.email ?? 'Logado');
        setUserId(data.session.user.id);
        pullFromSupabase(data.session.user.id);
      }
    });

    const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUserEmail(session.user.email ?? 'Logado');
        setUserId(session.user.id);
      } else {
        setUserEmail(null);
        setUserId(null);
      }
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, [isSbConfigured]);

  async function pullFromSupabase(uid: string) {
    const client = getSupabaseClient();
    if (!client) return;
    setSyncing(true);
    try {
      const [settingsRes, maintRes, logsRes, unexpRes] = await Promise.all([
        client.from('bike_settings').select('*').eq('user_id', uid).maybeSingle(),
        client.from('maintenance_items').select('*').eq('user_id', uid).order('created_at'),
        client.from('daily_logs').select('*').eq('user_id', uid).order('log_date', { ascending: false }),
        client.from('unexpected_expenses').select('*').eq('user_id', uid).order('expense_date', { ascending: false }),
      ]);

      if (settingsRes.data) {
        setSettings({
          bike_name: settingsRes.data.bike_name,
          fuel_consumption_km_l: Number(settingsRes.data.fuel_consumption_km_l),
          fuel_price_per_liter: Number(settingsRes.data.fuel_price_per_liter),
        });
      }
      if (maintRes.data && maintRes.data.length > 0) {
        setMaintenanceItems(
          maintRes.data.map((m: any) => ({
            id: m.id,
            name: m.name,
            cost: Number(m.cost),
            duration_km: Number(m.duration_km),
          }))
        );
      }
      if (logsRes.data && logsRes.data.length > 0) {
        setDailyLogs(
          logsRes.data.map((l: any) => ({
            id: l.id,
            log_date: l.log_date,
            earnings: Number(l.earnings),
            km_start: Number(l.km_start),
            km_end: Number(l.km_end),
            km_total: Number(l.km_total),
            start_time: l.start_time || '',
            end_time: l.end_time || '',
            notes: l.notes || '',
          }))
        );
      }
      if (unexpRes.data) {
        setUnexpectedExpenses(
          unexpRes.data.map((u: any) => ({
            id: u.id,
            expense_date: u.expense_date,
            description: u.description,
            amount: Number(u.amount),
          }))
        );
      }
      setAuthStatus('Dados sincronizados da nuvem Supabase com sucesso!');
    } catch (err: any) {
      setAuthStatus(`Erro ao buscar dados da nuvem: ${err.message || err}`);
    } finally {
      setSyncing(false);
    }
  }

  async function pushAllToSupabase() {
    const client = getSupabaseClient();
    if (!client || !userId) return;
    setSyncing(true);
    setAuthStatus('Enviando todos os dados para o Supabase...');
    try {
      // 1. Upsert bike_settings
      await client.from('bike_settings').upsert({
        user_id: userId,
        bike_name: settings.bike_name,
        fuel_consumption_km_l: settings.fuel_consumption_km_l,
        fuel_price_per_liter: settings.fuel_price_per_liter,
        updated_at: new Date().toISOString(),
      });

      // 2. Replace maintenance_items for user
      await client.from('maintenance_items').delete().eq('user_id', userId);
      if (maintenanceItems.length > 0) {
        await client.from('maintenance_items').insert(
          maintenanceItems.map((m) => ({
            user_id: userId,
            name: m.name,
            cost: m.cost,
            duration_km: m.duration_km,
          }))
        );
      }

      // 3. Replace daily_logs for user
      await client.from('daily_logs').delete().eq('user_id', userId);
      if (dailyLogs.length > 0) {
        await client.from('daily_logs').insert(
          dailyLogs.map((l) => ({
            user_id: userId,
            log_date: l.log_date,
            earnings: l.earnings,
            km_start: l.km_start,
            km_end: l.km_end,
            km_total: l.km_total,
            start_time: l.start_time || null,
            end_time: l.end_time || null,
            notes: l.notes || null,
          }))
        );
      }

      // 4. Replace unexpected_expenses for user
      await client.from('unexpected_expenses').delete().eq('user_id', userId);
      if (unexpectedExpenses.length > 0) {
        await client.from('unexpected_expenses').insert(
          unexpectedExpenses.map((u) => ({
            user_id: userId,
            expense_date: u.expense_date,
            description: u.description,
            amount: u.amount,
          }))
        );
      }

      await pullFromSupabase(userId);
      setAuthStatus('Todos os dados locais e da planilha foram salvos no Supabase!');
    } catch (err: any) {
      setAuthStatus(`Falha ao sincronizar: ${err.message || err}`);
    } finally {
      setSyncing(false);
    }
  }

  // Formulário de Lançamento Diário Rápido
  const todayStr = new Date().toISOString().slice(0, 10);
  const [logDate, setLogDate] = useState(todayStr);
  const [kmStart, setKmStart] = useState('');
  const [kmEnd, setKmEnd] = useState('');
  const [earnings, setEarnings] = useState('');
  const [startTime, setStartTime] = useState('09:40');
  const [endTime, setEndTime] = useState('17:00');
  const [saveToast, setSaveToast] = useState(false);

  // Preview em tempo real do lançamento atual
  const livePreviewLog: DailyLog = useMemo(() => {
    const start = parseFloat(kmStart.replace(',', '.')) || 0;
    const end = parseFloat(kmEnd.replace(',', '.')) || 0;
    const val = parseFloat(earnings.replace(',', '.')) || 0;
    const totalKm = Math.max(0, Number((end - start).toFixed(1)));
    return {
      id: 'preview',
      log_date: logDate,
      earnings: val,
      km_start: start,
      km_end: end,
      km_total: totalKm,
      start_time: startTime,
      end_time: endTime,
    };
  }, [logDate, kmStart, kmEnd, earnings, startTime, endTime]);

  const liveMetrics = useMemo(
    () => calculateDayMetrics(livePreviewLog, settings, maintenanceItems, unexpectedExpenses),
    [livePreviewLog, settings, maintenanceItems, unexpectedExpenses]
  );

  // Custo fixo por KM consolidado
  const fuelCostPerKm = useMemo(() => calcFuelCostPerKm(settings), [settings]);
  const maintCostPerKm = useMemo(() => calcMaintenanceCostPerKm(maintenanceItems), [maintenanceItems]);
  const totalFixedCostPerKm = fuelCostPerKm + maintCostPerKm;

  // Adicionar lançamento diário
  async function handleAddDailyLog(e: React.FormEvent) {
    e.preventDefault();
    if (livePreviewLog.km_total <= 0) {
      alert('O KM Final deve ser maior que o KM Inicial.');
      return;
    }
    const newLog: DailyLog = {
      ...livePreviewLog,
      id: crypto.randomUUID ? crypto.randomUUID() : `log-${Date.now()}`,
    };

    const updated = [newLog, ...dailyLogs].sort((a, b) => b.log_date.localeCompare(a.log_date));
    setDailyLogs(updated);

    // Próximo lançamento já puxa o KM Final como sugestão de KM Inicial
    setKmStart(String(livePreviewLog.km_end));
    setKmEnd('');
    setEarnings('');
    setSaveToast(true);
    setTimeout(() => setSaveToast(false), 3000);

    // Se estiver logado no Supabase, salva direto no banco
    const client = getSupabaseClient();
    if (client && userId) {
      await client.from('daily_logs').insert({
        user_id: userId,
        log_date: newLog.log_date,
        earnings: newLog.earnings,
        km_start: newLog.km_start,
        km_end: newLog.km_end,
        km_total: newLog.km_total,
        start_time: newLog.start_time || null,
        end_time: newLog.end_time || null,
      });
    }
  }

  async function handleDeleteLog(id: string) {
    setDailyLogs((prev) => prev.filter((item) => item.id !== id));
    const client = getSupabaseClient();
    if (client && userId) {
      await client.from('daily_logs').delete().eq('id', id).eq('user_id', userId);
    }
  }

  // Formulário de Nova Peça / Manutenção Preventiva
  const [newMaintName, setNewMaintName] = useState('');
  const [newMaintCost, setNewMaintCost] = useState('');
  const [newMaintDuration, setNewMaintDuration] = useState('');

  async function handleAddMaintenanceItem(e: React.FormEvent) {
    e.preventDefault();
    const cost = parseFloat(newMaintCost.replace(',', '.')) || 0;
    const duration = parseFloat(newMaintDuration.replace(',', '.')) || 0;
    if (!newMaintName.trim() || cost <= 0 || duration <= 0) return;

    const item: MaintenanceItem = {
      id: crypto.randomUUID ? crypto.randomUUID() : `maint-${Date.now()}`,
      name: newMaintName.trim(),
      cost,
      duration_km: duration,
    };

    setMaintenanceItems((prev) => [...prev, item]);
    setNewMaintName('');
    setNewMaintCost('');
    setNewMaintDuration('');

    const client = getSupabaseClient();
    if (client && userId) {
      await client.from('maintenance_items').insert({
        user_id: userId,
        name: item.name,
        cost: item.cost,
        duration_km: item.duration_km,
      });
    }
  }

  async function handleDeleteMaintenanceItem(id: string) {
    setMaintenanceItems((prev) => prev.filter((i) => i.id !== id));
    const client = getSupabaseClient();
    if (client && userId) {
      await client.from('maintenance_items').delete().eq('id', id).eq('user_id', userId);
    }
  }

  // Formulário de Gasto Inesperado (Peça quebrada / Imprevisto)
  const [unexpDate, setUnexpDate] = useState(todayStr);
  const [unexpDesc, setUnexpDesc] = useState('');
  const [unexpAmount, setUnexpAmount] = useState('');

  async function handleAddUnexpected(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseFloat(unexpAmount.replace(',', '.')) || 0;
    if (!unexpDesc.trim() || amount <= 0) return;

    const exp: UnexpectedExpense = {
      id: crypto.randomUUID ? crypto.randomUUID() : `unexp-${Date.now()}`,
      expense_date: unexpDate,
      description: unexpDesc.trim(),
      amount,
    };

    setUnexpectedExpenses((prev) => [exp, ...prev]);
    setUnexpDesc('');
    setUnexpAmount('');

    const client = getSupabaseClient();
    if (client && userId) {
      await client.from('unexpected_expenses').insert({
        user_id: userId,
        expense_date: exp.expense_date,
        description: exp.description,
        amount: exp.amount,
      });
    }
  }

  async function handleDeleteUnexpected(id: string) {
    setUnexpectedExpenses((prev) => prev.filter((u) => u.id !== id));
    const client = getSupabaseClient();
    if (client && userId) {
      await client.from('unexpected_expenses').delete().eq('id', id).eq('user_id', userId);
    }
  }

  // Filtro de mês no histórico
  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    dailyLogs.forEach((l) => {
      if (l.log_date && l.log_date.length >= 7) {
        set.add(l.log_date.slice(0, 7));
      }
    });
    return Array.from(set).sort().reverse();
  }, [dailyLogs]);

  const [selectedMonth, setSelectedMonth] = useState<string>('all');

  const filteredLogs = useMemo(() => {
    const sorted = [...dailyLogs].sort((a, b) => b.log_date.localeCompare(a.log_date));
    if (selectedMonth === 'all') return sorted;
    return sorted.filter((l) => l.log_date.startsWith(selectedMonth));
  }, [dailyLogs, selectedMonth]);

  // Resumo geral do período selecionado
  const summaryStats = useMemo(() => {
    let totalGross = 0;
    let totalKm = 0;
    let totalHours = 0;
    let totalFuel = 0;
    let totalMaint = 0;

    filteredLogs.forEach((l) => {
      const m = calculateDayMetrics(l, settings, maintenanceItems, []);
      totalGross += m.grossEarnings;
      totalKm += m.kmRodado;
      totalHours += m.hoursWorked;
      totalFuel += m.fuelCost;
      totalMaint += m.maintenanceCost;
    });

    const totalUnexpected = unexpectedExpenses
      .filter((u) => selectedMonth === 'all' || u.expense_date.startsWith(selectedMonth))
      .reduce((acc, cur) => acc + cur.amount, 0);

    const totalCost = totalFuel + totalMaint + totalUnexpected;
    const netProfit = totalGross - totalCost;
    const avgGrossPerKm = totalKm > 0 ? totalGross / totalKm : 0;
    const avgNetPerKm = totalKm > 0 ? netProfit / totalKm : 0;
    const avgGrossPerHour = totalHours > 0 ? totalGross / totalHours : 0;

    return {
      daysCount: filteredLogs.length,
      totalGross,
      totalKm,
      totalHours,
      totalFuel,
      totalMaint,
      totalUnexpected,
      totalCost,
      netProfit,
      avgGrossPerKm,
      avgNetPerKm,
      avgGrossPerHour,
    };
  }, [filteredLogs, settings, maintenanceItems, unexpectedExpenses, selectedMonth]);

  // Autenticação Supabase
  async function handleSupabaseAuth(e: React.FormEvent) {
    e.preventDefault();
    const client = getSupabaseClient();
    if (!client) {
      setAuthStatus('Configure a URL e a Anon Key do Supabase primeiro.');
      return;
    }
    setSyncing(true);
    setAuthStatus('');
    try {
      if (authMode === 'login') {
        const { data, error } = await client.auth.signInWithPassword({
          email: authEmailInput.trim(),
          password: authPasswordInput,
        });
        if (error) throw error;
        if (data.user) {
          setUserEmail(data.user.email ?? 'Logado');
          setUserId(data.user.id);
          await pullFromSupabase(data.user.id);
        }
      } else {
        const { data, error } = await client.auth.signUp({
          email: authEmailInput.trim(),
          password: authPasswordInput,
        });
        if (error) throw error;
        if (data.user) {
          setUserEmail(data.user.email ?? 'Logado');
          setUserId(data.user.id);
          setAuthStatus('Conta criada! Clique em "Enviar Dados Locais para Nuvem" para salvar seu histórico.');
        }
      }
    } catch (err: any) {
      setAuthStatus(`Erro: ${err.message || err}`);
    } finally {
      setSyncing(false);
    }
  }

  async function handleLogout() {
    const client = getSupabaseClient();
    if (client) {
      await client.auth.signOut();
    }
    setUserEmail(null);
    setUserId(null);
    setAuthStatus('Sessão encerrada. Seus dados continuam salvos no aparelho.');
  }

  function handleSaveCredentials(e: React.FormEvent) {
    e.preventDefault();
    if (!sbUrlInput.trim() || !sbKeyInput.trim()) return;
    saveSupabaseCredentials(sbUrlInput, sbKeyInput);
    setIsSbConfigured(true);
    setAuthStatus('Credenciais do Supabase salvas! Agora você pode fazer login ou criar sua conta.');
  }

  function handleExportBackup() {
    const payload = {
      exportedAt: new Date().toISOString(),
      settings,
      maintenanceItems,
      dailyLogs,
      unexpectedExpenses,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `motolucro-backup-${todayStr}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-24">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur border-b border-slate-800 px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Bike className="w-6 h-6" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight tracking-tight text-white flex items-center gap-2">
                MotoLucro
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-800 text-emerald-400 border border-slate-700">
                  R$ {totalFixedCostPerKm.toFixed(3).replace('.', ',')}/km custo
                </span>
              </h1>
              <p className="text-xs text-slate-400">
                Combustível: {formatPerKm(fuelCostPerKm)}/km • Manutenção: {formatPerKm(maintCostPerKm)}/km
              </p>
            </div>
          </div>

          <button
            onClick={() => setActiveTab('nuvem')}
            className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition ${
              userEmail
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Cloud className="w-3.5 h-3.5" />
            {userEmail ? 'Sincronizado' : 'Login / Nuvem'}
          </button>
        </div>
      </header>

      {/* Conteúdo Principal */}
      <main className="max-w-3xl mx-auto px-4 pt-5 space-y-6">
        {/* ABA 1: LANÇAR DIA (FOCO RÁPIDO E DIRETO) */}
        {activeTab === 'lancar' && (
          <div className="space-y-5">
            {/* Card Principal de Input Rápido */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-bold text-white">Fechamento do Dia</h2>
                  <p className="text-xs text-slate-400">
                    Informe KM Inicial, KM Final e Valor ganho para calcular seu lucro real na hora.
                  </p>
                </div>
                <span className="text-xs text-slate-400 bg-slate-800 px-2.5 py-1 rounded-md">
                  {settings.bike_name}
                </span>
              </div>

              <form onSubmit={handleAddDailyLog} className="space-y-4">
                {/* Linha 1: Data e Valor Obtido */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                      Data da Corrida
                    </label>
                    <div className="relative">
                      <input
                        type="date"
                        required
                        value={logDate}
                        onChange={(e) => setLogDate(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-xl px-3.5 py-3 text-base text-white outline-none transition"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-emerald-400 mb-1.5">
                      Valor Obtido no Dia (R$) *
                    </label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-semibold">
                        R$
                      </span>
                      <input
                        type="number"
                        step="0.01"
                        inputMode="decimal"
                        required
                        placeholder="Ex: 210,50"
                        value={earnings}
                        onChange={(e) => setEarnings(e.target.value)}
                        className="w-full bg-slate-950 border border-emerald-500/40 focus:border-emerald-400 rounded-xl pl-10 pr-3.5 py-3 text-lg font-bold text-white outline-none transition"
                      />
                    </div>
                  </div>
                </div>

                {/* Linha 2: KM Inicial e KM Final */}
                <div className="grid grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                      KM Inicial *
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      inputMode="decimal"
                      required
                      placeholder="Ex: 104.0"
                      value={kmStart}
                      onChange={(e) => setKmStart(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-xl px-3.5 py-3 text-lg font-semibold text-white outline-none transition"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                      KM Final *
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      inputMode="decimal"
                      required
                      placeholder="Ex: 224.0"
                      value={kmEnd}
                      onChange={(e) => setKmEnd(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-xl px-3.5 py-3 text-lg font-semibold text-white outline-none transition"
                    />
                  </div>
                </div>

                {/* Linha 3: Horário Início e Fim */}
                <div className="grid grid-cols-2 gap-3.5 pt-1">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-slate-500" /> Hora Início
                    </label>
                    <input
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-3.5 py-2.5 text-sm text-slate-200 outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-slate-500" /> Hora Fim
                    </label>
                    <input
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-3.5 py-2.5 text-sm text-slate-200 outline-none"
                    />
                  </div>
                </div>

                {/* Painel de Resultado Instantâneo do Dia */}
                <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
                    <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                      Distância & Tempo
                    </span>
                    <span className="text-sm font-bold text-white">
                      {liveMetrics.kmRodado.toFixed(1)} km rodados
                      {liveMetrics.hoursWorked > 0 && ` • ${liveMetrics.hoursWorked.toFixed(1)}h`}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
                    <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                      <span className="text-[11px] text-slate-400 block">Valor Bruto/KM</span>
                      <span className="text-base font-bold text-white">
                        {formatBRL(liveMetrics.grossPerKm)}
                      </span>
                    </div>

                    <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                      <span className="text-[11px] text-slate-400 block">Gasto Estimado</span>
                      <span className="text-base font-bold text-amber-400">
                        - {formatBRL(liveMetrics.totalCost)}
                      </span>
                      <span className="text-[10px] text-slate-500 block">
                        Gas: {formatBRL(liveMetrics.fuelCost)} | Manut: {formatBRL(liveMetrics.maintenanceCost)}
                      </span>
                    </div>

                    <div className="bg-emerald-950/30 p-2.5 rounded-lg border border-emerald-500/30">
                      <span className="text-[11px] text-emerald-300 block">Lucro Líquido (L.L)</span>
                      <span className="text-base font-extrabold text-emerald-400">
                        {formatBRL(liveMetrics.netProfit)}
                      </span>
                      <span className="text-[10px] text-emerald-500/80 block">
                        Líquido/KM: {formatBRL(liveMetrics.netPerKm)}
                      </span>
                    </div>

                    <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                      <span className="text-[11px] text-slate-400 block">Ganho / Hora</span>
                      <span className="text-base font-bold text-sky-400">
                        {formatBRL(liveMetrics.grossPerHour)}/h
                      </span>
                      <span className="text-[10px] text-slate-500 block">
                        Líquido: {formatBRL(liveMetrics.netPerHour)}/h
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full bg-emerald-500 hover:bg-emerald-400 active:scale-[0.99] text-slate-950 font-bold text-base py-3.5 rounded-xl shadow-lg shadow-emerald-500/10 flex items-center justify-center gap-2 transition"
                >
                  <PlusCircle className="w-5 h-5" />
                  Salvar Fechamento do Dia
                </button>

                {saveToast && (
                  <div className="flex items-center justify-center gap-2 text-emerald-400 text-sm font-medium bg-emerald-500/10 border border-emerald-500/20 py-2 rounded-lg">
                    <CheckCircle2 className="w-4 h-4" />
                    Dia registrado! O KM final já foi preenchido como KM inicial do próximo.
                  </div>
                )}
              </form>
            </div>

            {/* Últimos 5 lançamentos rápidos */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  Últimos Dias Registrados
                </h3>
                <button
                  onClick={() => setActiveTab('historico')}
                  className="text-xs text-emerald-400 hover:underline font-medium"
                >
                  Ver todos ({dailyLogs.length}) →
                </button>
              </div>

              <div className="divide-y divide-slate-800">
                {dailyLogs.slice(0, 5).map((log) => {
                  const m = calculateDayMetrics(log, settings, maintenanceItems, unexpectedExpenses);
                  return (
                    <div key={log.id} className="py-3 flex items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-white">
                            {formatDateBR(log.log_date)}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                            {m.kmRodado.toFixed(1)} km
                          </span>
                          {log.start_time && log.end_time && (
                            <span className="text-xs text-slate-500">
                              {log.start_time} - {log.end_time}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Bruto: {formatBRL(m.grossEarnings)} ({formatBRL(m.grossPerKm)}/km) • Custos:{' '}
                          <span className="text-amber-400">-{formatBRL(m.totalCost)}</span>
                        </p>
                      </div>

                      <div className="text-right">
                        <span className="text-sm font-bold text-emerald-400 block">
                          {formatBRL(m.netProfit)} L.L
                        </span>
                        <span className="text-[11px] text-slate-400">
                          {formatBRL(m.netPerKm)}/km líq.
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ABA 2: HISTÓRICO COMPLETO E RESUMO MENSAL */}
        {activeTab === 'historico' && (
          <div className="space-y-5">
            {/* Filtro de Mês e Exportação */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-4 rounded-2xl">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-semibold">Período:</span>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white outline-none"
                >
                  <option value="all">Todo o Histórico ({dailyLogs.length} dias)</option>
                  {availableMonths.map((m) => (
                    <option key={m} value={m}>
                      Mês {m.split('-')[1]}/{m.split('-')[0]}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleExportBackup}
                className="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-2 rounded-lg border border-slate-700 transition"
              >
                <Download className="w-3.5 h-3.5" />
                Exportar Backup JSON
              </button>
            </div>

            {/* Cards de Resumo Consolidado */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl">
                <span className="text-xs text-slate-400 block">Faturamento Bruto</span>
                <span className="text-lg font-bold text-white mt-0.5 block">
                  {formatBRL(summaryStats.totalGross)}
                </span>
                <span className="text-[11px] text-slate-400">
                  Média: {formatBRL(summaryStats.avgGrossPerKm)}/km
                </span>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl">
                <span className="text-xs text-slate-400 block">Total Custos (KM + Extra)</span>
                <span className="text-lg font-bold text-amber-400 mt-0.5 block">
                  - {formatBRL(summaryStats.totalCost)}
                </span>
                <span className="text-[11px] text-slate-400">
                  Gas: {formatBRL(summaryStats.totalFuel)} | Peças: {formatBRL(summaryStats.totalMaint)}
                </span>
              </div>

              <div className="bg-emerald-950/30 border border-emerald-500/30 p-4 rounded-2xl">
                <span className="text-xs text-emerald-300 block">Lucro Líquido Real</span>
                <span className="text-lg font-extrabold text-emerald-400 mt-0.5 block">
                  {formatBRL(summaryStats.netProfit)}
                </span>
                <span className="text-[11px] text-emerald-400/90">
                  Líquido: {formatBRL(summaryStats.avgNetPerKm)}/km
                </span>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl">
                <span className="text-xs text-slate-400 block">KM Total & Horas</span>
                <span className="text-lg font-bold text-sky-400 mt-0.5 block">
                  {summaryStats.totalKm.toFixed(0)} km
                </span>
                <span className="text-[11px] text-slate-400">
                  {summaryStats.daysCount} dias • {formatBRL(summaryStats.avgGrossPerHour)}/h
                </span>
              </div>
            </div>

            {/* Lista Detalhada de Registros */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">Diário de Entregas</h3>
                <span className="text-xs text-slate-400">{filteredLogs.length} registros</span>
              </div>

              <div className="divide-y divide-slate-800/80 max-h-[540px] overflow-y-auto">
                {filteredLogs.map((log) => {
                  const m = calculateDayMetrics(log, settings, maintenanceItems, unexpectedExpenses);
                  return (
                    <div
                      key={log.id}
                      className="p-4 hover:bg-slate-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-white">
                            {formatDateBR(log.log_date)}
                          </span>
                          <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded">
                            KM: {log.km_start} → {log.km_end} ({m.kmRodado.toFixed(1)} km)
                          </span>
                          {log.start_time && log.end_time && (
                            <span className="text-xs text-slate-400">
                              ⏰ {log.start_time} às {log.end_time} ({m.hoursWorked.toFixed(1)}h)
                            </span>
                          )}
                        </div>

                        <div className="text-xs text-slate-400 flex flex-wrap gap-x-3 gap-y-1">
                          <span>
                            Bruto: <strong className="text-slate-200">{formatBRL(m.grossEarnings)}</strong>
                          </span>
                          <span>
                            Valor/KM: <strong className="text-slate-200">{formatBRL(m.grossPerKm)}</strong>
                          </span>
                          <span>
                            Gasolina: <strong className="text-amber-400">-{formatBRL(m.fuelCost)}</strong>
                          </span>
                          <span>
                            Manut. KM: <strong className="text-amber-400">-{formatBRL(m.maintenanceCost)}</strong>
                          </span>
                          {m.unexpectedCost > 0 && (
                            <span>
                              Imprevisto: <strong className="text-rose-400">-{formatBRL(m.unexpectedCost)}</strong>
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-4 border-t sm:border-t-0 border-slate-800 pt-2 sm:pt-0">
                        <div className="text-left sm:text-right">
                          <span className="text-sm font-extrabold text-emerald-400 block">
                            L.L: {formatBRL(m.netProfit)}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {formatBRL(m.netPerKm)}/km • {m.costPercent.toFixed(0)}% custo
                          </span>
                        </div>

                        <button
                          onClick={() => handleDeleteLog(log.id)}
                          title="Excluir registro"
                          className="p-2 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ABA 3: CUSTOS POR KM (PEÇAS E CONSUMO DA MOTO) */}
        {activeTab === 'custos' && (
          <div className="space-y-5">
            {/* Card 1: Consumo e Combustível */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-2.5">
                <Fuel className="w-5 h-5 text-emerald-400" />
                <div>
                  <h2 className="text-base font-bold text-white">Consumo da Moto & Gasolina</h2>
                  <p className="text-xs text-slate-400">
                    Usado para descontar automaticamente o combustível de cada KM rodado no dia.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    Modelo / Apelido da Moto
                  </label>
                  <input
                    type="text"
                    value={settings.bike_name}
                    onChange={(e) => setSettings({ ...settings, bike_name: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    Consumo Médio (KM por Litro)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={settings.fuel_consumption_km_l}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        fuel_consumption_km_l: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-bold text-white outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    Preço Médio Gasolina (R$/Litro)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={settings.fuel_price_per_liter}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        fuel_price_per_liter: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-bold text-white outline-none"
                  />
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-center justify-between text-xs">
                <span className="text-slate-400">Custo de Combustível por KM:</span>
                <span className="font-bold text-emerald-400 text-sm">
                  {formatPerKm(fuelCostPerKm)} / km
                </span>
              </div>
            </div>

            {/* Card 2: Despesas Fixas de Manutenção por KM */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Wrench className="w-5 h-5 text-emerald-400" />
                  <div>
                    <h2 className="text-base font-bold text-white">
                      Peças e Manutenção Preventiva por KM
                    </h2>
                    <p className="text-xs text-slate-400">
                      Cadastre cada peça e quantos KMs ela dura para manter seu custo por KM alinhado.
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[11px] text-slate-400 block">Soma Manutenção/KM</span>
                  <span className="text-base font-extrabold text-amber-400">
                    {formatPerKm(maintCostPerKm)}/km
                  </span>
                </div>
              </div>

              {/* Tabela de Peças */}
              <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
                {maintenanceItems.map((item) => {
                  const perKm = item.duration_km > 0 ? item.cost / item.duration_km : 0;
                  return (
                    <div
                      key={item.id}
                      className="px-4 py-3 flex items-center justify-between gap-2 text-sm"
                    >
                      <div>
                        <span className="font-semibold text-white block">{item.name}</span>
                        <span className="text-xs text-slate-400">
                          Valor: {formatBRL(item.cost)} • Dura: {item.duration_km.toLocaleString('pt-BR')} km
                        </span>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <span className="text-xs font-bold text-amber-400 block">
                            {formatPerKm(perKm)}/km
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {formatBRL(perKm * 1000)} a cada 1.000 km
                          </span>
                        </div>
                        <button
                          onClick={() => handleDeleteMaintenanceItem(item.id)}
                          className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Adicionar Nova Peça */}
              <form onSubmit={handleAddMaintenanceItem} className="pt-2 space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Adicionar Nova Despesa por KM
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <input
                    type="text"
                    required
                    placeholder="Item (ex: Óleo + Filtro)"
                    value={newMaintName}
                    onChange={(e) => setNewMaintName(e.target.value)}
                    className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white outline-none"
                  />
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="Valor (R$ ex: 120)"
                    value={newMaintCost}
                    onChange={(e) => setNewMaintCost(e.target.value)}
                    className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white outline-none"
                  />
                  <input
                    type="number"
                    step="1"
                    required
                    placeholder="Duração KM (ex: 3000)"
                    value={newMaintDuration}
                    onChange={(e) => setNewMaintDuration(e.target.value)}
                    className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white outline-none"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full sm:w-auto px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm rounded-xl transition"
                >
                  + Incluir no Custo por KM
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ABA 4: IMPREVISTOS (GASTOS INESPERADOS / PEÇAS DE REPOSIÇÃO AVULSAS) */}
        {activeTab === 'imprevistos' && (
          <div className="space-y-5">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-5 h-5 text-rose-400" />
                <div>
                  <h2 className="text-base font-bold text-white">
                    Gastos Inesperados / Manutenção Extra
                  </h2>
                  <p className="text-xs text-slate-400">
                    Estragou uma peça de repente, furou pneu ou precisou repor algo fora do previsto? Registre aqui para abater do seu lucro real.
                  </p>
                </div>
              </div>

              <form onSubmit={handleAddUnexpected} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  type="date"
                  required
                  value={unexpDate}
                  onChange={(e) => setUnexpDate(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white outline-none"
                />
                <input
                  type="text"
                  required
                  placeholder="O que aconteceu? (ex: Cabo embreagem)"
                  value={unexpDesc}
                  onChange={(e) => setUnexpDesc(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white outline-none"
                />
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="Valor R$"
                    value={unexpAmount}
                    onChange={(e) => setUnexpAmount(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white outline-none"
                  />
                  <button
                    type="submit"
                    className="px-4 bg-rose-500 hover:bg-rose-400 text-slate-950 font-bold text-sm rounded-xl shrink-0 transition"
                  >
                    Salvar
                  </button>
                </div>
              </form>

              {unexpectedExpenses.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-sm border border-dashed border-slate-800 rounded-xl">
                  Nenhum imprevisto registrado até o momento.
                </div>
              ) : (
                <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl bg-slate-950">
                  {unexpectedExpenses.map((u) => (
                    <div key={u.id} className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <span className="font-semibold text-sm text-white block">
                          {u.description}
                        </span>
                        <span className="text-xs text-slate-400">
                          Data: {formatDateBR(u.expense_date)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-rose-400">
                          - {formatBRL(u.amount)}
                        </span>
                        <button
                          onClick={() => handleDeleteUnexpected(u.id)}
                          className="p-1.5 text-slate-500 hover:text-rose-400"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ABA 5: LOGIN SUPABASE & BACKUP NUVEM */}
        {activeTab === 'nuvem' && (
          <div className="space-y-5">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-2.5">
                <Cloud className="w-5 h-5 text-emerald-400" />
                <div>
                  <h2 className="text-base font-bold text-white">
                    Login & Banco de Dados Online (Supabase)
                  </h2>
                  <p className="text-xs text-slate-400">
                    Conecte seu projeto Supabase para sincronizar seus lançamentos na nuvem com login seguro e nunca perder dados.
                  </p>
                </div>
              </div>

              {authStatus && (
                <div className="p-3 rounded-xl bg-slate-950 border border-emerald-500/40 text-xs text-emerald-300">
                  {authStatus}
                </div>
              )}

              {/* Se já estiver logado */}
              {userEmail ? (
                <div className="space-y-3 bg-slate-950 border border-slate-800 p-4 rounded-xl">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs text-slate-400 block">Conectado como:</span>
                      <span className="text-sm font-bold text-emerald-400">{userEmail}</span>
                    </div>
                    <button
                      onClick={handleLogout}
                      className="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-2 rounded-lg"
                    >
                      <LogOut className="w-3.5 h-3.5" /> Sair
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-2">
                    <button
                      disabled={syncing}
                      onClick={pushAllToSupabase}
                      className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs px-4 py-2.5 rounded-xl transition"
                    >
                      <UploadCloud className="w-4 h-4" />
                      {syncing ? 'Sincronizando...' : 'Enviar Dados Locais / Planilha para a Nuvem'}
                    </button>

                    <button
                      disabled={syncing}
                      onClick={() => userId && pullFromSupabase(userId)}
                      className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs px-4 py-2.5 rounded-xl transition"
                    >
                      Baixar Dados da Nuvem
                    </button>
                  </div>
                </div>
              ) : (
                /* Formulário de Login / Cadastro */
                <form
                  onSubmit={handleSupabaseAuth}
                  className="bg-slate-950 border border-slate-800 p-4 rounded-xl space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                      <LogIn className="w-4 h-4 text-emerald-400" />
                      {authMode === 'login' ? 'Entrar na sua Conta' : 'Criar Nova Conta'}
                    </h3>
                    <button
                      type="button"
                      onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}
                      className="text-xs text-emerald-400 hover:underline"
                    >
                      {authMode === 'login'
                        ? 'Não tem conta? Cadastre-se'
                        : 'Já tem conta? Fazer Login'}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      type="email"
                      required
                      placeholder="Seu e-mail"
                      value={authEmailInput}
                      onChange={(e) => setAuthEmailInput(e.target.value)}
                      className="bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none"
                    />
                    <input
                      type="password"
                      required
                      minLength={6}
                      placeholder="Sua senha (mín. 6 dígitos)"
                      value={authPasswordInput}
                      onChange={(e) => setAuthPasswordInput(e.target.value)}
                      className="bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={syncing}
                    className="w-full sm:w-auto px-6 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm rounded-xl transition"
                  >
                    {syncing
                      ? 'Aguarde...'
                      : authMode === 'login'
                      ? 'Entrar e Sincronizar'
                      : 'Criar Conta no Supabase'}
                  </button>
                </form>
              )}

              {/* Configuração rápida da URL e Key do Supabase (caso não esteja em variável de ambiente) */}
              <form
                onSubmit={handleSaveCredentials}
                className="bg-slate-950/60 border border-slate-800/80 p-4 rounded-xl space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Conexão do Projeto Supabase (VITE_SUPABASE_URL & ANON_KEY)
                  </span>
                  {isSbConfigured && (
                    <button
                      type="button"
                      onClick={() => {
                        clearSupabaseCredentials();
                        setSbUrlInput('');
                        setSbKeyInput('');
                        setIsSbConfigured(false);
                      }}
                      className="text-[11px] text-rose-400 hover:underline"
                    >
                      Limpar chaves
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <input
                    type="url"
                    placeholder="https://xyz.supabase.co"
                    value={sbUrlInput}
                    onChange={(e) => setSbUrlInput(e.target.value)}
                    className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none"
                  />
                  <input
                    type="password"
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... (anon public key)"
                    value={sbKeyInput}
                    onChange={(e) => setSbKeyInput(e.target.value)}
                    className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none"
                  />
                </div>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition"
                >
                  Salvar Conexão Supabase
                </button>
              </form>

              {/* SQL Schema pronto para copiar e colar no Supabase */}
              <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300">
                    SQL para criar as tabelas no Supabase (SQL Editor)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(SQL_SCHEMA_TEXT);
                      setCopiedSql(true);
                      setTimeout(() => setCopiedSql(false), 2500);
                    }}
                    className="flex items-center gap-1 text-xs bg-slate-800 hover:bg-slate-700 px-2.5 py-1 rounded text-emerald-400"
                  >
                    {copiedSql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedSql ? 'SQL Copiado!' : 'Copiar SQL'}
                  </button>
                </div>
                <pre className="text-[11px] text-slate-400 overflow-x-auto max-h-40 p-2 bg-slate-900 rounded border border-slate-800">
                  {SQL_SCHEMA_TEXT}
                </pre>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Navegação Inferior Fixa (Mobile-First) */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-slate-900/95 backdrop-blur border-t border-slate-800">
        <div className="max-w-3xl mx-auto grid grid-cols-5">
          <button
            onClick={() => setActiveTab('lancar')}
            className={`flex flex-col items-center justify-center py-2.5 gap-1 text-[11px] font-semibold transition ${
              activeTab === 'lancar' ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <PlusCircle className="w-5 h-5" />
            <span>Lançar Dia</span>
          </button>

          <button
            onClick={() => setActiveTab('historico')}
            className={`flex flex-col items-center justify-center py-2.5 gap-1 text-[11px] font-semibold transition ${
              activeTab === 'historico' ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <History className="w-5 h-5" />
            <span>Histórico</span>
          </button>

          <button
            onClick={() => setActiveTab('custos')}
            className={`flex flex-col items-center justify-center py-2.5 gap-1 text-[11px] font-semibold transition ${
              activeTab === 'custos' ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Wrench className="w-5 h-5" />
            <span>Custo/KM</span>
          </button>

          <button
            onClick={() => setActiveTab('imprevistos')}
            className={`flex flex-col items-center justify-center py-2.5 gap-1 text-[11px] font-semibold transition ${
              activeTab === 'imprevistos' ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <AlertTriangle className="w-5 h-5" />
            <span>Imprevistos</span>
          </button>

          <button
            onClick={() => setActiveTab('nuvem')}
            className={`flex flex-col items-center justify-center py-2.5 gap-1 text-[11px] font-semibold transition ${
              activeTab === 'nuvem' ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cloud className="w-5 h-5" />
            <span>Supabase</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
