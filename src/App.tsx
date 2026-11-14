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
  CheckCircle2,
  LogOut,
  LogIn,
  UploadCloud,
  Download,
  Calendar,
  Pencil,
  X,
  RotateCcw,
  User,
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
  getLocalTodayStr,
  generateUuid,
  ensureValidUuid,
  sortDailyLogsDesc,
} from './calculations';
import { getSupabaseClient, getSupabaseCredentials } from './supabaseClient';

const LS_SETTINGS_KEY = 'motolucro_bike_settings_v1';
const LS_MAINT_KEY = 'motolucro_maint_items_v1';
const LS_LOGS_KEY = 'motolucro_daily_logs_v1';
const LS_UNEXPECTED_KEY = 'motolucro_unexpected_v1';

type TabType = 'lancar' | 'historico' | 'custos' | 'imprevistos' | 'nuvem';

interface UndoPayload {
  kind: 'log' | 'maint' | 'unexp';
  label: string;
  item: DailyLog | MaintenanceItem | UnexpectedExpense;
}

function getCurrentTimeHHMM(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('lancar');

  // Estado principal (com fallback imediato para LocalStorage + Planilha Inicial e IDs normalizados)
  const [settings, setSettings] = useState<BikeSettings>(() => {
    try {
      const saved = localStorage.getItem(LS_SETTINGS_KEY);
      return saved ? JSON.parse(saved) : DEFAULT_BIKE_SETTINGS;
    } catch {
      return DEFAULT_BIKE_SETTINGS;
    }
  });

  const [maintenanceItems, setMaintenanceItems] = useState<MaintenanceItem[]>(() => {
    try {
      const saved = localStorage.getItem(LS_MAINT_KEY);
      const raw: MaintenanceItem[] = saved ? JSON.parse(saved) : DEFAULT_MAINTENANCE_ITEMS;
      return raw.map((item) => ({ ...item, id: ensureValidUuid(item.id) }));
    } catch {
      return DEFAULT_MAINTENANCE_ITEMS.map((item) => ({ ...item, id: ensureValidUuid(item.id) }));
    }
  });

  const [dailyLogs, setDailyLogs] = useState<DailyLog[]>(() => {
    try {
      const saved = localStorage.getItem(LS_LOGS_KEY);
      const raw: DailyLog[] = saved ? JSON.parse(saved) : SEED_DAILY_LOGS;
      return sortDailyLogsDesc(raw.map((log) => ({ ...log, id: ensureValidUuid(log.id) })));
    } catch {
      return sortDailyLogsDesc(SEED_DAILY_LOGS.map((log) => ({ ...log, id: ensureValidUuid(log.id) })));
    }
  });

  const [unexpectedExpenses, setUnexpectedExpenses] = useState<UnexpectedExpense[]>(() => {
    try {
      const saved = localStorage.getItem(LS_UNEXPECTED_KEY);
      const raw: UnexpectedExpense[] = saved ? JSON.parse(saved) : DEFAULT_UNEXPECTED_EXPENSES;
      return raw.map((u) => ({ ...u, id: ensureValidUuid(u.id) }));
    } catch {
      return DEFAULT_UNEXPECTED_EXPENSES.map((u) => ({ ...u, id: ensureValidUuid(u.id) }));
    }
  });

  // Lista sempre ordenada da data mais recente para a mais antiga
  const sortedDailyLogs = useMemo(() => sortDailyLogsDesc(dailyLogs), [dailyLogs]);

  // Último KM Final registrado para sugerir automaticamente no KM Inicial
  const latestKmEnd = useMemo(() => {
    for (const log of sortedDailyLogs) {
      if (log.km_end > 0) return log.km_end;
    }
    return 0;
  }, [sortedDailyLogs]);

  // Inputs de texto controlados para Consumo e Preço da Gasolina (evita travar em 0 ao apagar)
  const [fuelConsumptionInput, setFuelConsumptionInput] = useState<string>(() =>
    String(settings.fuel_consumption_km_l)
  );
  const [fuelPriceInput, setFuelPriceInput] = useState<string>(() =>
    String(settings.fuel_price_per_liter)
  );
  const [settingsSavedToast, setSettingsSavedToast] = useState(false);

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
  const [cloudErrorBanner, setCloudErrorBanner] = useState<string>('');

  // Credenciais pré-configuradas do Supabase
  const isSbConfigured = getSupabaseCredentials().isConfigured;

  // Formulário de Lançamento Diário Rápido (data em fuso local + KM Inicial preenchido com último KM Final)
  const todayStr = getLocalTodayStr();
  const [logDate, setLogDate] = useState(todayStr);
  const [kmStart, setKmStart] = useState<string>(() => (latestKmEnd > 0 ? String(latestKmEnd) : ''));
  const [kmEnd, setKmEnd] = useState('');
  const [earnings, setEarnings] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [editingMainLogId, setEditingMainLogId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string>('');
  const [saveToast, setSaveToast] = useState<string>('');

  // Estado para confirmação de exclusão e Desfazer (Undo)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [undoData, setUndoData] = useState<UndoPayload | null>(null);

  // Estado de Edição Inline no Histórico
  const [histEditId, setHistEditId] = useState<string | null>(null);
  const [histEditDate, setHistEditDate] = useState('');
  const [histEditEarnings, setHistEditEarnings] = useState('');
  const [histEditKmStart, setHistEditKmStart] = useState('');
  const [histEditKmEnd, setHistEditKmEnd] = useState('');
  const [histEditStartTime, setHistEditStartTime] = useState('');
  const [histEditEndTime, setHistEditEndTime] = useState('');
  const [histEditError, setHistEditError] = useState('');

  // Estado de Edição Inline em Peças / Manutenção
  const [maintEditId, setMaintEditId] = useState<string | null>(null);
  const [maintEditName, setMaintEditName] = useState('');
  const [maintEditCost, setMaintEditCost] = useState('');
  const [maintEditDuration, setMaintEditDuration] = useState('');
  const [maintEditError, setMaintEditError] = useState('');

  // Estado de Edição Inline em Imprevistos
  const [unexpEditId, setUnexpEditId] = useState<string | null>(null);
  const [unexpEditDate, setUnexpEditDate] = useState('');
  const [unexpEditDesc, setUnexpEditDesc] = useState('');
  const [unexpEditAmount, setUnexpEditAmount] = useState('');
  const [unexpEditError, setUnexpEditError] = useState('');

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

  async function syncSettingsToSupabase(nextSettings: BikeSettings, showToast = false) {
    if (showToast) {
      setSettingsSavedToast(true);
      setTimeout(() => setSettingsSavedToast(false), 2500);
    }
    const client = getSupabaseClient();
    if (!client || !userId) return;
    const { error } = await client.from('bike_settings').upsert({
      user_id: userId,
      bike_name: nextSettings.bike_name,
      fuel_consumption_km_l: nextSettings.fuel_consumption_km_l,
      fuel_price_per_liter: nextSettings.fuel_price_per_liter,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      setCloudErrorBanner(`Erro ao salvar configurações na nuvem: ${error.message}`);
    } else {
      setCloudErrorBanner('');
    }
  }

  async function pullFromSupabase(uid: string) {
    const client = getSupabaseClient();
    if (!client) return;
    setSyncing(true);
    setCloudErrorBanner('');
    try {
      const [settingsRes, maintRes, logsRes, unexpRes] = await Promise.all([
        client.from('bike_settings').select('*').eq('user_id', uid).maybeSingle(),
        client.from('maintenance_items').select('*').eq('user_id', uid).order('created_at'),
        client.from('daily_logs').select('*').eq('user_id', uid).order('log_date', { ascending: false }),
        client
          .from('unexpected_expenses')
          .select('*')
          .eq('user_id', uid)
          .order('expense_date', { ascending: false }),
      ]);

      const firstErr =
        settingsRes.error || maintRes.error || logsRes.error || unexpRes.error;
      if (firstErr) {
        throw new Error(firstErr.message);
      }

      const hasRemoteData =
        Boolean(settingsRes.data) ||
        (maintRes.data && maintRes.data.length > 0) ||
        (logsRes.data && logsRes.data.length > 0) ||
        (unexpRes.data && unexpRes.data.length > 0);

      if (!hasRemoteData) {
        setAuthStatus(
          'Conta conectada! Nenhum dado salvo na nuvem ainda — clique em "Enviar Dados Locais para a Nuvem" para sincronizar seu histórico.'
        );
        return;
      }

      if (settingsRes.data) {
        const nextSettings: BikeSettings = {
          bike_name: settingsRes.data.bike_name,
          fuel_consumption_km_l: Number(settingsRes.data.fuel_consumption_km_l),
          fuel_price_per_liter: Number(settingsRes.data.fuel_price_per_liter),
        };
        setSettings(nextSettings);
        setFuelConsumptionInput(String(nextSettings.fuel_consumption_km_l));
        setFuelPriceInput(String(nextSettings.fuel_price_per_liter));
      }

      if (maintRes.data) {
        setMaintenanceItems(
          maintRes.data.map((m: any) => ({
            id: m.id,
            name: m.name,
            cost: Number(m.cost),
            duration_km: Number(m.duration_km),
          }))
        );
      }

      if (logsRes.data) {
        const mappedLogs = sortDailyLogsDesc(
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
        setDailyLogs(mappedLogs);
        if (!editingMainLogId && !kmEnd && !earnings && mappedLogs.length > 0 && mappedLogs[0].km_end > 0) {
          setKmStart(String(mappedLogs[0].km_end));
        }
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
    setAuthStatus('Enviando e sincronizando dados com o Supabase...');
    setCloudErrorBanner('');
    try {
      // 1. Upsert bike_settings
      const { error: settingsErr } = await client.from('bike_settings').upsert({
        user_id: userId,
        bike_name: settings.bike_name,
        fuel_consumption_km_l: settings.fuel_consumption_km_l,
        fuel_price_per_liter: settings.fuel_price_per_liter,
        updated_at: new Date().toISOString(),
      });
      if (settingsErr) throw new Error(`Configurações: ${settingsErr.message}`);

      // 2. Upsert seguro de maintenance_items (sem apagar antes de validar o envio)
      const normalizedMaint = maintenanceItems.map((m) => ({
        ...m,
        id: ensureValidUuid(m.id),
      }));
      if (normalizedMaint.length > 0) {
        const { error: maintUpsertErr } = await client.from('maintenance_items').upsert(
          normalizedMaint.map((m) => ({
            id: m.id,
            user_id: userId,
            name: m.name,
            cost: m.cost,
            duration_km: m.duration_km,
          })),
          { onConflict: 'id' }
        );
        if (maintUpsertErr) throw new Error(`Peças: ${maintUpsertErr.message}`);
      }

      // 3. Upsert seguro de daily_logs
      const normalizedLogs = dailyLogs.map((l) => ({
        ...l,
        id: ensureValidUuid(l.id),
      }));
      if (normalizedLogs.length > 0) {
        const { error: logsUpsertErr } = await client.from('daily_logs').upsert(
          normalizedLogs.map((l) => ({
            id: l.id,
            user_id: userId,
            log_date: l.log_date,
            earnings: l.earnings,
            km_start: l.km_start,
            km_end: l.km_end,
            km_total: l.km_total,
            start_time: l.start_time || null,
            end_time: l.end_time || null,
            notes: l.notes || null,
          })),
          { onConflict: 'id' }
        );
        if (logsUpsertErr) throw new Error(`Diário: ${logsUpsertErr.message}`);
      }

      // 4. Upsert seguro de unexpected_expenses
      const normalizedUnexp = unexpectedExpenses.map((u) => ({
        ...u,
        id: ensureValidUuid(u.id),
      }));
      if (normalizedUnexp.length > 0) {
        const { error: unexpUpsertErr } = await client.from('unexpected_expenses').upsert(
          normalizedUnexp.map((u) => ({
            id: u.id,
            user_id: userId,
            expense_date: u.expense_date,
            description: u.description,
            amount: u.amount,
          })),
          { onConflict: 'id' }
        );
        if (unexpUpsertErr) throw new Error(`Imprevistos: ${unexpUpsertErr.message}`);
      }

      await pullFromSupabase(userId);
      setAuthStatus('Todos os dados locais e da planilha foram salvos com segurança no Supabase!');
    } catch (err: any) {
      setAuthStatus(`Falha ao sincronizar: ${err.message || err}`);
    } finally {
      setSyncing(false);
    }
  }

  // Preview em tempo real do lançamento atual
  const livePreviewLog: DailyLog = useMemo(() => {
    const start = parseFloat(kmStart.replace(',', '.')) || 0;
    const end = parseFloat(kmEnd.replace(',', '.')) || 0;
    const val = parseFloat(earnings.replace(',', '.')) || 0;
    const totalKm = end > start ? Number((end - start).toFixed(1)) : 0;
    return {
      id: editingMainLogId || 'preview',
      log_date: logDate,
      earnings: val,
      km_start: start,
      km_end: end,
      km_total: totalKm,
      start_time: startTime,
      end_time: endTime,
    };
  }, [editingMainLogId, logDate, kmStart, kmEnd, earnings, startTime, endTime]);

  const unexpectedOnFormDate = useMemo(
    () =>
      unexpectedExpenses
        .filter((e) => e.expense_date === logDate)
        .reduce((sum, e) => sum + (e.amount || 0), 0),
    [unexpectedExpenses, logDate]
  );

  // Evita exibir prejuízo negativo enganoso no card de preview quando KM e Valor ainda estão em branco (0)
  const hasActivePreviewInput = livePreviewLog.km_total > 0 || livePreviewLog.earnings > 0;
  const liveMetrics = useMemo(
    () =>
      calculateDayMetrics(
        livePreviewLog,
        settings,
        maintenanceItems,
        hasActivePreviewInput ? unexpectedExpenses : []
      ),
    [livePreviewLog, settings, maintenanceItems, unexpectedExpenses, hasActivePreviewInput]
  );

  // Custo fixo por KM consolidado
  const fuelCostPerKm = useMemo(() => calcFuelCostPerKm(settings), [settings]);
  const maintCostPerKm = useMemo(() => calcMaintenanceCostPerKm(maintenanceItems), [maintenanceItems]);
  const totalFixedCostPerKm = fuelCostPerKm + maintCostPerKm;

  function triggerUndoBanner(payload: UndoPayload) {
    setUndoData(payload);
  }

  async function handleUndoDelete() {
    if (!undoData) return;
    const client = getSupabaseClient();
    if (undoData.kind === 'log') {
      const log = undoData.item as DailyLog;
      setDailyLogs((prev) => sortDailyLogsDesc([log, ...prev.filter((i) => i.id !== log.id)]));
      if (client && userId) {
        await client.from('daily_logs').upsert({
          id: ensureValidUuid(log.id),
          user_id: userId,
          log_date: log.log_date,
          earnings: log.earnings,
          km_start: log.km_start,
          km_end: log.km_end,
          km_total: log.km_total,
          start_time: log.start_time || null,
          end_time: log.end_time || null,
          notes: log.notes || null,
        });
      }
    } else if (undoData.kind === 'maint') {
      const item = undoData.item as MaintenanceItem;
      setMaintenanceItems((prev) => [...prev.filter((i) => i.id !== item.id), item]);
      if (client && userId) {
        await client.from('maintenance_items').upsert({
          id: ensureValidUuid(item.id),
          user_id: userId,
          name: item.name,
          cost: item.cost,
          duration_km: item.duration_km,
        });
      }
    } else if (undoData.kind === 'unexp') {
      const exp = undoData.item as UnexpectedExpense;
      setUnexpectedExpenses((prev) => [exp, ...prev.filter((i) => i.id !== exp.id)]);
      if (client && userId) {
        await client.from('unexpected_expenses').upsert({
          id: ensureValidUuid(exp.id),
          user_id: userId,
          expense_date: exp.expense_date,
          description: exp.description,
          amount: exp.amount,
        });
      }
    }
    setUndoData(null);
  }

  // Carregar um lançamento no formulário principal para edição
  function startEditInMainForm(log: DailyLog, scrollToTop = true) {
    setEditingMainLogId(log.id);
    setLogDate(log.log_date);
    setEarnings(String(log.earnings));
    setKmStart(String(log.km_start));
    setKmEnd(String(log.km_end));
    setStartTime(log.start_time || '');
    setEndTime(log.end_time || '');
    setFormError('');
    setSaveToast('');
    setActiveTab('lancar');
    if (scrollToTop) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  // Ao selecionar uma data no formulário: se já houver registro salvo nesse dia, puxa os dados como edição
  function handleMainDateChange(newDate: string) {
    setFormError('');
    setSaveToast('');
    const existingForDate = dailyLogs.find((item) => item.log_date === newDate);
    if (existingForDate) {
      startEditInMainForm(existingForDate, false);
    } else {
      setLogDate(newDate);
      if (editingMainLogId) {
        setEditingMainLogId(null);
        setEarnings('');
        setKmStart(latestKmEnd > 0 ? String(latestKmEnd) : '');
        setKmEnd('');
        setStartTime('');
        setEndTime('');
      }
    }
  }

  function cancelMainFormEdit() {
    setEditingMainLogId(null);
    setLogDate(todayStr);
    setEarnings('');
    setKmStart(latestKmEnd > 0 ? String(latestKmEnd) : '');
    setKmEnd('');
    setStartTime('');
    setEndTime('');
    setFormError('');
  }

  // Adicionar ou atualizar lançamento diário no formulário principal
  async function handleAddDailyLog(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');

    const start = parseFloat(kmStart.replace(',', '.'));
    const end = parseFloat(kmEnd.replace(',', '.'));
    const val = parseFloat(earnings.replace(',', '.'));

    if (isNaN(val) || val < 0) {
      setFormError('Informe um valor obtido válido (0 ou maior).');
      return;
    }
    if (isNaN(start) || isNaN(end) || end <= start) {
      setFormError('O KM Final deve ser maior que o KM Inicial.');
      return;
    }

    const totalKm = Number((end - start).toFixed(1));
    const existingLog = editingMainLogId
      ? dailyLogs.find((item) => item.id === editingMainLogId)
      : dailyLogs.find((item) => item.log_date === logDate);
    const targetId = existingLog ? existingLog.id : editingMainLogId;
    const recordId = targetId ? ensureValidUuid(targetId) : generateUuid();

    const savedLog: DailyLog = {
      id: recordId,
      log_date: logDate,
      earnings: val,
      km_start: start,
      km_end: end,
      km_total: totalKm,
      start_time: startTime,
      end_time: endTime,
      notes: existingLog?.notes || '',
    };

    const updated = sortDailyLogsDesc([
      savedLog,
      ...dailyLogs.filter(
        (item) => item.id !== targetId && item.id !== recordId && item.log_date !== logDate
      ),
    ]);
    setDailyLogs(updated);

    const wasEditing = Boolean(targetId);
    setEditingMainLogId(null);

    // Próximo lançamento volta para a data de hoje e puxa o maior KM Final como sugestão de KM Inicial
    setLogDate(todayStr);
    const nextLatestKm = updated.length > 0 && updated[0].km_end > 0 ? updated[0].km_end : end;
    setKmStart(String(nextLatestKm));
    setKmEnd('');
    setEarnings('');
    setStartTime('');
    setEndTime('');
    setSaveToast(
      wasEditing
        ? 'Alterações salvas com sucesso!'
        : 'Dia registrado! O KM final já foi preenchido como KM inicial do próximo.'
    );
    setTimeout(() => setSaveToast(''), 3500);

    // Se estiver logado no Supabase, faz upsert com o mesmo UUID
    const client = getSupabaseClient();
    if (client && userId) {
      const { error } = await client.from('daily_logs').upsert(
        {
          id: savedLog.id,
          user_id: userId,
          log_date: savedLog.log_date,
          earnings: savedLog.earnings,
          km_start: savedLog.km_start,
          km_end: savedLog.km_end,
          km_total: savedLog.km_total,
          start_time: savedLog.start_time || null,
          end_time: savedLog.end_time || null,
          notes: savedLog.notes || null,
        },
        { onConflict: 'id' }
      );
      if (error) {
        setCloudErrorBanner(`Salvo no aparelho, mas falhou na nuvem: ${error.message}`);
      }
    }
  }

  // Edição inline de registro no Histórico
  function startInlineHistoryEdit(log: DailyLog) {
    setHistEditId(log.id);
    setHistEditDate(log.log_date);
    setHistEditEarnings(String(log.earnings));
    setHistEditKmStart(String(log.km_start));
    setHistEditKmEnd(String(log.km_end));
    setHistEditStartTime(log.start_time || '');
    setHistEditEndTime(log.end_time || '');
    setHistEditError('');
    setConfirmDeleteId(null);
  }

  async function handleSaveInlineHistoryEdit(e: React.FormEvent, originalLog: DailyLog) {
    e.preventDefault();
    setHistEditError('');
    const start = parseFloat(histEditKmStart.replace(',', '.'));
    const end = parseFloat(histEditKmEnd.replace(',', '.'));
    const val = parseFloat(histEditEarnings.replace(',', '.'));

    if (isNaN(val) || val < 0) {
      setHistEditError('Informe um valor obtido válido (0 ou maior).');
      return;
    }
    if (isNaN(start) || isNaN(end) || end <= start) {
      setHistEditError('O KM Final deve ser maior que o KM Inicial.');
      return;
    }

    const updatedLog: DailyLog = {
      ...originalLog,
      id: ensureValidUuid(originalLog.id),
      log_date: histEditDate,
      earnings: val,
      km_start: start,
      km_end: end,
      km_total: Number((end - start).toFixed(1)),
      start_time: histEditStartTime,
      end_time: histEditEndTime,
    };

    const nextLogs = sortDailyLogsDesc(
      dailyLogs.map((item) => (item.id === originalLog.id ? updatedLog : item))
    );
    setDailyLogs(nextLogs);
    setHistEditId(null);

    if (!editingMainLogId && !kmEnd && !earnings && nextLogs.length > 0 && nextLogs[0].km_end > 0) {
      setKmStart(String(nextLogs[0].km_end));
    }

    const client = getSupabaseClient();
    if (client && userId) {
      const { error } = await client.from('daily_logs').upsert(
        {
          id: updatedLog.id,
          user_id: userId,
          log_date: updatedLog.log_date,
          earnings: updatedLog.earnings,
          km_start: updatedLog.km_start,
          km_end: updatedLog.km_end,
          km_total: updatedLog.km_total,
          start_time: updatedLog.start_time || null,
          end_time: updatedLog.end_time || null,
          notes: updatedLog.notes || null,
        },
        { onConflict: 'id' }
      );
      if (error) {
        setCloudErrorBanner(`Edição salva no aparelho, mas falhou na nuvem: ${error.message}`);
      }
    }
  }

  async function handleDeleteLog(log: DailyLog) {
    setDailyLogs((prev) => prev.filter((item) => item.id !== log.id));
    setConfirmDeleteId(null);
    triggerUndoBanner({
      kind: 'log',
      label: `Dia ${formatDateBR(log.log_date)} (${formatBRL(log.earnings)})`,
      item: log,
    });

    const client = getSupabaseClient();
    if (client && userId) {
      await client.from('daily_logs').delete().eq('id', ensureValidUuid(log.id)).eq('user_id', userId);
    }
  }

  // Formulário de Nova Peça / Manutenção Preventiva
  const [newMaintName, setNewMaintName] = useState('');
  const [newMaintCost, setNewMaintCost] = useState('');
  const [newMaintDuration, setNewMaintDuration] = useState('');
  const [maintFormError, setMaintFormError] = useState('');

  async function handleAddMaintenanceItem(e: React.FormEvent) {
    e.preventDefault();
    setMaintFormError('');
    const cost = parseFloat(newMaintCost.replace(',', '.')) || 0;
    const duration = parseFloat(newMaintDuration.replace(',', '.')) || 0;
    if (!newMaintName.trim() || cost <= 0 || duration <= 0) {
      setMaintFormError('Preencha o nome da peça, valor maior que zero e duração em KM.');
      return;
    }

    const item: MaintenanceItem = {
      id: generateUuid(),
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
      const { error } = await client.from('maintenance_items').upsert(
        {
          id: item.id,
          user_id: userId,
          name: item.name,
          cost: item.cost,
          duration_km: item.duration_km,
        },
        { onConflict: 'id' }
      );
      if (error) {
        setCloudErrorBanner(`Peça salva no aparelho, mas falhou na nuvem: ${error.message}`);
      }
    }
  }

  function startInlineMaintEdit(item: MaintenanceItem) {
    setMaintEditId(item.id);
    setMaintEditName(item.name);
    setMaintEditCost(String(item.cost));
    setMaintEditDuration(String(item.duration_km));
    setMaintEditError('');
    setConfirmDeleteId(null);
  }

  async function handleSaveInlineMaintEdit(e: React.FormEvent, original: MaintenanceItem) {
    e.preventDefault();
    setMaintEditError('');
    const cost = parseFloat(maintEditCost.replace(',', '.')) || 0;
    const duration = parseFloat(maintEditDuration.replace(',', '.')) || 0;
    if (!maintEditName.trim() || cost <= 0 || duration <= 0) {
      setMaintEditError('Informe nome, valor maior que zero e duração em KM.');
      return;
    }

    const updated: MaintenanceItem = {
      id: ensureValidUuid(original.id),
      name: maintEditName.trim(),
      cost,
      duration_km: duration,
    };

    setMaintenanceItems((prev) => prev.map((i) => (i.id === original.id ? updated : i)));
    setMaintEditId(null);

    const client = getSupabaseClient();
    if (client && userId) {
      const { error } = await client.from('maintenance_items').upsert(
        {
          id: updated.id,
          user_id: userId,
          name: updated.name,
          cost: updated.cost,
          duration_km: updated.duration_km,
        },
        { onConflict: 'id' }
      );
      if (error) {
        setCloudErrorBanner(`Edição salva no aparelho, mas falhou na nuvem: ${error.message}`);
      }
    }
  }

  async function handleDeleteMaintenanceItem(item: MaintenanceItem) {
    setMaintenanceItems((prev) => prev.filter((i) => i.id !== item.id));
    setConfirmDeleteId(null);
    triggerUndoBanner({
      kind: 'maint',
      label: `Peça "${item.name}" (${formatBRL(item.cost)})`,
      item,
    });

    const client = getSupabaseClient();
    if (client && userId) {
      await client
        .from('maintenance_items')
        .delete()
        .eq('id', ensureValidUuid(item.id))
        .eq('user_id', userId);
    }
  }

  // Formulário de Gasto Inesperado (Peça quebrada / Imprevisto)
  const [unexpDate, setUnexpDate] = useState(todayStr);
  const [unexpDesc, setUnexpDesc] = useState('');
  const [unexpAmount, setUnexpAmount] = useState('');
  const [unexpFormError, setUnexpFormError] = useState('');

  async function handleAddUnexpected(e: React.FormEvent) {
    e.preventDefault();
    setUnexpFormError('');
    const amount = parseFloat(unexpAmount.replace(',', '.')) || 0;
    if (!unexpDesc.trim() || amount <= 0) {
      setUnexpFormError('Informe a descrição do imprevisto e um valor maior que zero.');
      return;
    }

    const exp: UnexpectedExpense = {
      id: generateUuid(),
      expense_date: unexpDate,
      description: unexpDesc.trim(),
      amount,
    };

    setUnexpectedExpenses((prev) => [exp, ...prev]);
    setUnexpDesc('');
    setUnexpAmount('');

    const client = getSupabaseClient();
    if (client && userId) {
      const { error } = await client.from('unexpected_expenses').upsert(
        {
          id: exp.id,
          user_id: userId,
          expense_date: exp.expense_date,
          description: exp.description,
          amount: exp.amount,
        },
        { onConflict: 'id' }
      );
      if (error) {
        setCloudErrorBanner(`Imprevisto salvo no aparelho, mas falhou na nuvem: ${error.message}`);
      }
    }
  }

  function startInlineUnexpEdit(exp: UnexpectedExpense) {
    setUnexpEditId(exp.id);
    setUnexpEditDate(exp.expense_date);
    setUnexpEditDesc(exp.description);
    setUnexpEditAmount(String(exp.amount));
    setUnexpEditError('');
    setConfirmDeleteId(null);
  }

  async function handleSaveInlineUnexpEdit(e: React.FormEvent, original: UnexpectedExpense) {
    e.preventDefault();
    setUnexpEditError('');
    const amount = parseFloat(unexpEditAmount.replace(',', '.')) || 0;
    if (!unexpEditDesc.trim() || amount <= 0) {
      setUnexpEditError('Preencha a descrição e um valor maior que zero.');
      return;
    }

    const updated: UnexpectedExpense = {
      id: ensureValidUuid(original.id),
      expense_date: unexpEditDate,
      description: unexpEditDesc.trim(),
      amount,
    };

    setUnexpectedExpenses((prev) => prev.map((u) => (u.id === original.id ? updated : u)));
    setUnexpEditId(null);

    const client = getSupabaseClient();
    if (client && userId) {
      const { error } = await client.from('unexpected_expenses').upsert(
        {
          id: updated.id,
          user_id: userId,
          expense_date: updated.expense_date,
          description: updated.description,
          amount: updated.amount,
        },
        { onConflict: 'id' }
      );
      if (error) {
        setCloudErrorBanner(`Edição salva no aparelho, mas falhou na nuvem: ${error.message}`);
      }
    }
  }

  async function handleDeleteUnexpected(exp: UnexpectedExpense) {
    setUnexpectedExpenses((prev) => prev.filter((u) => u.id !== exp.id));
    setConfirmDeleteId(null);
    triggerUndoBanner({
      kind: 'unexp',
      label: `Imprevisto "${exp.description}" (${formatBRL(exp.amount)})`,
      item: exp,
    });

    const client = getSupabaseClient();
    if (client && userId) {
      await client
        .from('unexpected_expenses')
        .delete()
        .eq('id', ensureValidUuid(exp.id))
        .eq('user_id', userId);
    }
  }

  // Filtro de mês no histórico
  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    sortedDailyLogs.forEach((l) => {
      if (l.log_date && l.log_date.length >= 7) {
        set.add(l.log_date.slice(0, 7));
      }
    });
    return Array.from(set).sort().reverse();
  }, [sortedDailyLogs]);

  const [selectedMonth, setSelectedMonth] = useState<string>('all');

  const filteredLogs = useMemo(() => {
    if (selectedMonth === 'all') return sortedDailyLogs;
    return sortedDailyLogs.filter((l) => l.log_date.startsWith(selectedMonth));
  }, [sortedDailyLogs, selectedMonth]);

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
          setAuthStatus(
            'Conta criada! Clique em "Enviar Dados Locais / Planilha para a Nuvem" para salvar seu histórico.'
          );
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

  function handleExportBackup() {
    const payload = {
      exportedAt: new Date().toISOString(),
      settings,
      maintenanceItems,
      dailyLogs: sortedDailyLogs,
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
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 shrink-0 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Bike className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <h1 className="font-bold text-lg leading-tight tracking-tight text-white flex flex-wrap items-center gap-2">
                <span>MotoLucro</span>
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-800 text-emerald-400 border border-slate-700">
                  {formatBRL(totalFixedCostPerKm)}/km custo
                </span>
              </h1>
              <p className="text-xs text-slate-400 truncate">
                Combustível: {formatPerKm(fuelCostPerKm)}/km • Manutenção: {formatPerKm(maintCostPerKm)}/km
              </p>
            </div>
          </div>

          <button
            onClick={() => setActiveTab('nuvem')}
            className={`shrink-0 flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition ${
              userEmail
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            {userEmail ? 'Sincronizado' : 'Minha Conta'}
          </button>
        </div>
      </header>

      {/* Banner de Desfazer Exclusão (Undo) */}
      {undoData && (
        <div className="max-w-3xl mx-auto px-4 pt-3">
          <div className="bg-slate-900 border border-amber-500/40 rounded-xl px-4 py-2.5 flex items-center justify-between gap-3 shadow-lg">
            <span className="text-xs text-slate-200">
              Excluído: <strong className="text-white">{undoData.label}</strong>
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleUndoDelete}
                className="flex items-center gap-1 text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 px-3 py-1.5 rounded-lg transition"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Desfazer
              </button>
              <button
                type="button"
                onClick={() => setUndoData(null)}
                className="p-1 text-slate-400 hover:text-slate-200"
                title="Fechar aviso"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Aviso de erro de sincronização com a nuvem */}
      {cloudErrorBanner && (
        <div className="max-w-3xl mx-auto px-4 pt-3">
          <div className="bg-rose-950/60 border border-rose-500/40 rounded-xl px-4 py-2.5 flex items-center justify-between gap-2 text-xs text-rose-200">
            <span>{cloudErrorBanner}</span>
            <button
              type="button"
              onClick={() => setCloudErrorBanner('')}
              className="text-rose-300 hover:text-white p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Conteúdo Principal */}
      <main className="max-w-3xl mx-auto px-4 pt-5 space-y-6">
        {/* ABA 1: LANÇAR DIA (FOCO RÁPIDO E DIRETO) */}
        {activeTab === 'lancar' && (
          <div className="space-y-5">
            {/* Card Principal de Input Rápido */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
              <div className="flex items-center justify-between gap-2 mb-4">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    {editingMainLogId ? 'Editar Lançamento do Dia' : 'Fechamento do Dia'}
                    {editingMainLogId && (
                      <span className="text-[11px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full">
                        Modo Edição
                      </span>
                    )}
                  </h2>
                  <p className="text-xs text-slate-400">
                    Informe KM Inicial, KM Final e Valor ganho para calcular seu lucro real na hora.
                  </p>
                </div>
                <span className="text-xs text-slate-400 bg-slate-800 px-2.5 py-1 rounded-md shrink-0">
                  {settings.bike_name}
                </span>
              </div>

              <form onSubmit={handleAddDailyLog} className="space-y-4">
                {/* Linha 1: Data e Valor Obtido */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1.5">
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Data da Corrida
                      </label>
                      {editingMainLogId && (
                        <span className="text-[11px] text-amber-300 font-medium">
                          Dia já registrado (editando)
                        </span>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        type="date"
                        required
                        value={logDate}
                        onChange={(e) => handleMainDateChange(e.target.value)}
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
                        onChange={(e) => {
                          setEarnings(e.target.value);
                          setFormError('');
                        }}
                        className="w-full bg-slate-950 border border-emerald-500/40 focus:border-emerald-400 rounded-xl pl-10 pr-3.5 py-3 text-lg font-bold text-white outline-none transition"
                      />
                    </div>
                  </div>
                </div>

                {/* Linha 2: KM Inicial e KM Final */}
                <div className="grid grid-cols-2 gap-3.5">
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1.5">
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                        KM Inicial *
                      </label>
                      {latestKmEnd > 0 && kmStart !== String(latestKmEnd) && (
                        <button
                          type="button"
                          onClick={() => {
                            setKmStart(String(latestKmEnd));
                            setFormError('');
                          }}
                          className="text-[11px] text-emerald-400 hover:underline font-medium"
                        >
                          Usar último ({latestKmEnd})
                        </button>
                      )}
                    </div>
                    <input
                      type="number"
                      step="0.1"
                      inputMode="decimal"
                      required
                      placeholder="Ex: 1835.0"
                      value={kmStart}
                      onChange={(e) => {
                        setKmStart(e.target.value);
                        setFormError('');
                      }}
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
                      placeholder="Ex: 1980.0"
                      value={kmEnd}
                      onChange={(e) => {
                        setKmEnd(e.target.value);
                        setFormError('');
                      }}
                      className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-xl px-3.5 py-3 text-lg font-semibold text-white outline-none transition"
                    />
                  </div>
                </div>

                {/* Linha 3: Horário Início e Fim (Opcionais com atalho Agora) */}
                <div className="grid grid-cols-2 gap-3.5 pt-1">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-slate-400 flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-slate-500" /> Hora Início
                      </label>
                      <button
                        type="button"
                        onClick={() => setStartTime(getCurrentTimeHHMM())}
                        className="text-[11px] text-slate-400 hover:text-emerald-400"
                      >
                        Agora
                      </button>
                    </div>
                    <input
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-3.5 py-2.5 text-sm text-slate-200 outline-none"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-slate-400 flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-slate-500" /> Hora Fim
                      </label>
                      <button
                        type="button"
                        onClick={() => setEndTime(getCurrentTimeHHMM())}
                        className="text-[11px] text-slate-400 hover:text-emerald-400"
                      >
                        Agora
                      </button>
                    </div>
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

                  {unexpectedOnFormDate > 0 && !hasActivePreviewInput && (
                    <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1.5">
                      Há {formatBRL(unexpectedOnFormDate)} em imprevistos nesta data (será descontado ao preencher o dia).
                    </div>
                  )}

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
                        {liveMetrics.unexpectedCost > 0 && ` | Imprev: ${formatBRL(liveMetrics.unexpectedCost)}`}
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

                {/* Aviso de validação inline (substitui alert nativo) */}
                {formError && (
                  <div
                    role="alert"
                    className="flex items-center gap-2 text-rose-300 text-xs font-medium bg-rose-500/10 border border-rose-500/30 px-3.5 py-2.5 rounded-xl"
                  >
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>{formError}</span>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2.5">
                  <button
                    type="submit"
                    className="flex-1 bg-emerald-500 hover:bg-emerald-400 active:scale-[0.99] text-slate-950 font-bold text-base py-3.5 rounded-xl shadow-lg shadow-emerald-500/10 flex items-center justify-center gap-2 transition"
                  >
                    <PlusCircle className="w-5 h-5" />
                    {editingMainLogId ? 'Salvar Alterações do Dia' : 'Salvar Fechamento do Dia'}
                  </button>

                  {editingMainLogId && (
                    <button
                      type="button"
                      onClick={cancelMainFormEdit}
                      className="px-5 py-3.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-sm rounded-xl border border-slate-700 transition"
                    >
                      Cancelar Edição
                    </button>
                  )}
                </div>

                {saveToast && (
                  <div className="flex items-center justify-center gap-2 text-emerald-400 text-sm font-medium bg-emerald-500/10 border border-emerald-500/20 py-2 px-3 rounded-lg">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{saveToast}</span>
                  </div>
                )}
              </form>
            </div>

            {/* Últimos 5 lançamentos rápidos (ordenados da data mais recente para a mais antiga) */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  Últimos Dias Registrados
                </h3>
                <button
                  onClick={() => setActiveTab('historico')}
                  className="text-xs text-emerald-400 hover:underline font-medium"
                >
                  Ver todos ({sortedDailyLogs.length}) →
                </button>
              </div>

              <div className="divide-y divide-slate-800">
                {sortedDailyLogs.slice(0, 5).map((log) => {
                  const m = calculateDayMetrics(log, settings, maintenanceItems, unexpectedExpenses);
                  return (
                    <div
                      key={log.id}
                      className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-white">
                            {formatDateBR(log.log_date)}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                            {m.kmRodado.toFixed(1)} km ({log.km_start} → {log.km_end})
                          </span>
                          {log.start_time && log.end_time && (
                            <span className="text-xs text-slate-500">
                              {log.start_time} - {log.end_time}
                            </span>
                          )}
                          {log.earnings === 0 && (
                            <span className="text-[11px] bg-amber-500/15 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded">
                              Bruto pendente (R$ 0,00)
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Bruto: {formatBRL(m.grossEarnings)} ({formatBRL(m.grossPerKm)}/km) • Custos:{' '}
                          <span className="text-amber-400">-{formatBRL(m.totalCost)}</span>
                        </p>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3">
                        <div className="text-left sm:text-right">
                          <span
                            className={`text-sm font-bold block ${
                              m.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {formatBRL(m.netProfit)} L.L
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {formatBRL(m.netPerKm)}/km líq.
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => startEditInMainForm(log)}
                          title="Editar registro"
                          aria-label="Editar registro"
                          className="flex items-center gap-1 text-xs text-slate-300 hover:text-emerald-400 bg-slate-800/80 hover:bg-slate-800 border border-slate-700 px-2.5 py-1.5 rounded-lg transition"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          <span>Editar</span>
                        </button>
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
                  <option value="all">Todo o Histórico ({sortedDailyLogs.length} dias)</option>
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
                <span className="text-[11px] text-slate-400 block">
                  Gas: {formatBRL(summaryStats.totalFuel)} | Peças: {formatBRL(summaryStats.totalMaint)} | Imprev.:{' '}
                  {formatBRL(summaryStats.totalUnexpected)}
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

              <div className="divide-y divide-slate-800/80 max-h-[600px] overflow-y-auto">
                {filteredLogs.map((log) => {
                  const m = calculateDayMetrics(log, settings, maintenanceItems, unexpectedExpenses);
                  const isEditingThis = histEditId === log.id;
                  const isConfirmingDelete = confirmDeleteId === log.id;

                  if (isEditingThis) {
                    return (
                      <form
                        key={log.id}
                        onSubmit={(e) => handleSaveInlineHistoryEdit(e, log)}
                        className="p-4 bg-slate-950/90 space-y-3 border-l-2 border-emerald-500"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                            Editando lançamento ({formatDateBR(log.log_date)})
                          </span>
                          <button
                            type="button"
                            onClick={() => setHistEditId(null)}
                            className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
                          >
                            <X className="w-3.5 h-3.5" /> Fechar
                          </button>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">Data</label>
                            <input
                              type="date"
                              required
                              value={histEditDate}
                              onChange={(e) => setHistEditDate(e.target.value)}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-emerald-400 font-semibold mb-1">
                              Valor Bruto (R$)
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              required
                              value={histEditEarnings}
                              onChange={(e) => setHistEditEarnings(e.target.value)}
                              className="w-full bg-slate-900 border border-emerald-500/40 rounded-lg px-2.5 py-2 text-xs font-bold text-white"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">KM Inicial</label>
                            <input
                              type="number"
                              step="0.1"
                              required
                              value={histEditKmStart}
                              onChange={(e) => setHistEditKmStart(e.target.value)}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">KM Final</label>
                            <input
                              type="number"
                              step="0.1"
                              required
                              value={histEditKmEnd}
                              onChange={(e) => setHistEditKmEnd(e.target.value)}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">Hora Início</label>
                            <input
                              type="time"
                              value={histEditStartTime}
                              onChange={(e) => setHistEditStartTime(e.target.value)}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">Hora Fim</label>
                            <input
                              type="time"
                              value={histEditEndTime}
                              onChange={(e) => setHistEditEndTime(e.target.value)}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white"
                            />
                          </div>
                        </div>

                        {histEditError && (
                          <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 px-3 py-2 rounded-lg">
                            {histEditError}
                          </div>
                        )}

                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="submit"
                            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg transition"
                          >
                            Salvar Alterações
                          </button>
                          <button
                            type="button"
                            onClick={() => setHistEditId(null)}
                            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg transition"
                          >
                            Cancelar
                          </button>
                        </div>
                      </form>
                    );
                  }

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
                          {log.earnings === 0 && (
                            <span className="text-[11px] bg-amber-500/15 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded">
                              Bruto R$ 0,00 (clique em Editar para preencher)
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

                      <div className="flex items-center justify-between sm:justify-end gap-3 border-t sm:border-t-0 border-slate-800 pt-2 sm:pt-0">
                        <div className="text-left sm:text-right">
                          <span
                            className={`text-sm font-extrabold block ${
                              m.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            L.L: {formatBRL(m.netProfit)}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {formatBRL(m.netPerKm)}/km • {m.costPercent.toFixed(0)}% custo
                          </span>
                        </div>

                        {isConfirmingDelete ? (
                          <div className="flex items-center gap-1.5 bg-rose-950/50 border border-rose-500/40 px-2.5 py-1.5 rounded-lg">
                            <span className="text-[11px] text-rose-200 font-medium">Excluir?</span>
                            <button
                              type="button"
                              onClick={() => handleDeleteLog(log)}
                              className="text-xs font-bold bg-rose-500 hover:bg-rose-400 text-slate-950 px-2 py-1 rounded"
                            >
                              Confirmar
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-xs text-slate-300 hover:text-white px-1.5 py-1"
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => startInlineHistoryEdit(log)}
                              title="Editar registro"
                              aria-label="Editar registro"
                              className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-300 hover:text-emerald-400 rounded-lg bg-slate-800/80 hover:bg-slate-800 border border-slate-700 transition"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              <span>Editar</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(log.id)}
                              title="Excluir registro"
                              aria-label="Excluir registro"
                              className="p-2 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
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
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <Fuel className="w-5 h-5 text-emerald-400" />
                  <div>
                    <h2 className="text-base font-bold text-white">Consumo da Moto & Gasolina</h2>
                    <p className="text-xs text-slate-400">
                      Usado para descontar automaticamente o combustível de cada KM rodado no dia.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => syncSettingsToSupabase(settings, true)}
                  className="text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 px-3 py-1.5 rounded-lg transition shrink-0"
                >
                  {settingsSavedToast ? 'Salvo!' : 'Salvar Moto'}
                </button>
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
                    onBlur={() => syncSettingsToSupabase(settings)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    Consumo Médio (KM por Litro)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Ex: 30"
                    value={fuelConsumptionInput}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setFuelConsumptionInput(raw);
                      const parsed = parseFloat(raw.replace(',', '.'));
                      if (!isNaN(parsed) && parsed > 0) {
                        setSettings((prev) => ({ ...prev, fuel_consumption_km_l: parsed }));
                      }
                    }}
                    onBlur={() => {
                      const parsed = parseFloat(fuelConsumptionInput.replace(',', '.'));
                      if (!isNaN(parsed) && parsed > 0) {
                        const next = { ...settings, fuel_consumption_km_l: parsed };
                        setSettings(next);
                        setFuelConsumptionInput(String(parsed));
                        syncSettingsToSupabase(next);
                      } else {
                        setFuelConsumptionInput(String(settings.fuel_consumption_km_l));
                      }
                    }}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-bold text-white outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    Preço Médio Gasolina (R$/Litro)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Ex: 5,89"
                    value={fuelPriceInput}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setFuelPriceInput(raw);
                      const parsed = parseFloat(raw.replace(',', '.'));
                      if (!isNaN(parsed) && parsed > 0) {
                        setSettings((prev) => ({ ...prev, fuel_price_per_liter: parsed }));
                      }
                    }}
                    onBlur={() => {
                      const parsed = parseFloat(fuelPriceInput.replace(',', '.'));
                      if (!isNaN(parsed) && parsed > 0) {
                        const next = { ...settings, fuel_price_per_liter: parsed };
                        setSettings(next);
                        setFuelPriceInput(String(parsed));
                        syncSettingsToSupabase(next);
                      } else {
                        setFuelPriceInput(String(settings.fuel_price_per_liter));
                      }
                    }}
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
                      Cadastre ou edite cada peça e quantos KMs ela dura para manter seu custo por KM alinhado.
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
                  const isEditingThis = maintEditId === item.id;
                  const isConfirmingDelete = confirmDeleteId === item.id;

                  if (isEditingThis) {
                    return (
                      <form
                        key={item.id}
                        onSubmit={(e) => handleSaveInlineMaintEdit(e, item)}
                        className="p-4 bg-slate-900/90 space-y-3 border-l-2 border-emerald-500"
                      >
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">Peça / Item</label>
                            <input
                              type="text"
                              required
                              value={maintEditName}
                              onChange={(e) => setMaintEditName(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">Valor (R$)</label>
                            <input
                              type="number"
                              step="0.01"
                              required
                              value={maintEditCost}
                              onChange={(e) => setMaintEditCost(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">Duração (KM)</label>
                            <input
                              type="number"
                              step="1"
                              required
                              value={maintEditDuration}
                              onChange={(e) => setMaintEditDuration(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white"
                            />
                          </div>
                        </div>

                        {maintEditError && (
                          <div className="text-xs text-rose-300">{maintEditError}</div>
                        )}

                        <div className="flex items-center gap-2">
                          <button
                            type="submit"
                            className="px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg"
                          >
                            Salvar Peça
                          </button>
                          <button
                            type="button"
                            onClick={() => setMaintEditId(null)}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg"
                          >
                            Cancelar
                          </button>
                        </div>
                      </form>
                    );
                  }

                  return (
                    <div
                      key={item.id}
                      className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm"
                    >
                      <div>
                        <span className="font-semibold text-white block">{item.name}</span>
                        <span className="text-xs text-slate-400">
                          Valor: {formatBRL(item.cost)} • Dura: {item.duration_km.toLocaleString('pt-BR')} km
                        </span>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3">
                        <div className="text-left sm:text-right">
                          <span className="text-xs font-bold text-amber-400 block">
                            {formatPerKm(perKm)}/km
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {formatBRL(perKm * 1000)} a cada 1.000 km
                          </span>
                        </div>

                        {isConfirmingDelete ? (
                          <div className="flex items-center gap-1.5 bg-rose-950/50 border border-rose-500/40 px-2.5 py-1 rounded-lg">
                            <span className="text-[11px] text-rose-200">Excluir?</span>
                            <button
                              type="button"
                              onClick={() => handleDeleteMaintenanceItem(item)}
                              className="text-xs font-bold bg-rose-500 hover:bg-rose-400 text-slate-950 px-2 py-0.5 rounded"
                            >
                              Sim
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-xs text-slate-300 px-1.5 py-0.5"
                            >
                              Não
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => startInlineMaintEdit(item)}
                              title="Editar peça"
                              aria-label="Editar peça"
                              className="flex items-center gap-1 px-2.5 py-1 text-xs text-slate-300 hover:text-emerald-400 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 transition"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              <span>Editar</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(item.id)}
                              title="Excluir peça"
                              aria-label="Excluir peça"
                              className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
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
                {maintFormError && (
                  <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 px-3 py-2 rounded-lg">
                    {maintFormError}
                  </div>
                )}
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

              <form onSubmit={handleAddUnexpected} className="space-y-2.5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                </div>
                {unexpFormError && (
                  <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 px-3 py-2 rounded-lg">
                    {unexpFormError}
                  </div>
                )}
              </form>

              {unexpectedExpenses.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-sm border border-dashed border-slate-800 rounded-xl">
                  Nenhum imprevisto registrado até o momento.
                </div>
              ) : (
                <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl bg-slate-950">
                  {unexpectedExpenses.map((u) => {
                    const isEditingThis = unexpEditId === u.id;
                    const isConfirmingDelete = confirmDeleteId === u.id;

                    if (isEditingThis) {
                      return (
                        <form
                          key={u.id}
                          onSubmit={(e) => handleSaveInlineUnexpEdit(e, u)}
                          className="p-4 bg-slate-900/90 space-y-3 border-l-2 border-rose-500"
                        >
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                            <input
                              type="date"
                              required
                              value={unexpEditDate}
                              onChange={(e) => setUnexpEditDate(e.target.value)}
                              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white"
                            />
                            <input
                              type="text"
                              required
                              value={unexpEditDesc}
                              onChange={(e) => setUnexpEditDesc(e.target.value)}
                              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white"
                            />
                            <input
                              type="number"
                              step="0.01"
                              required
                              value={unexpEditAmount}
                              onChange={(e) => setUnexpEditAmount(e.target.value)}
                              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white"
                            />
                          </div>
                          {unexpEditError && (
                            <div className="text-xs text-rose-300">{unexpEditError}</div>
                          )}
                          <div className="flex items-center gap-2">
                            <button
                              type="submit"
                              className="px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg"
                            >
                              Salvar Imprevisto
                            </button>
                            <button
                              type="button"
                              onClick={() => setUnexpEditId(null)}
                              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg"
                            >
                              Cancelar
                            </button>
                          </div>
                        </form>
                      );
                    }

                    return (
                      <div
                        key={u.id}
                        className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                      >
                        <div>
                          <span className="font-semibold text-sm text-white block">
                            {u.description}
                          </span>
                          <span className="text-xs text-slate-400">
                            Data: {formatDateBR(u.expense_date)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between sm:justify-end gap-3">
                          <span className="text-sm font-bold text-rose-400">
                            - {formatBRL(u.amount)}
                          </span>

                          {isConfirmingDelete ? (
                            <div className="flex items-center gap-1.5 bg-rose-950/50 border border-rose-500/40 px-2.5 py-1 rounded-lg">
                              <span className="text-[11px] text-rose-200">Excluir?</span>
                              <button
                                type="button"
                                onClick={() => handleDeleteUnexpected(u)}
                                className="text-xs font-bold bg-rose-500 hover:bg-rose-400 text-slate-950 px-2 py-0.5 rounded"
                              >
                                Sim
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="text-xs text-slate-300 px-1.5 py-0.5"
                              >
                                Não
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => startInlineUnexpEdit(u)}
                                title="Editar imprevisto"
                                aria-label="Editar imprevisto"
                                className="flex items-center gap-1 px-2.5 py-1 text-xs text-slate-300 hover:text-emerald-400 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 transition"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                                <span>Editar</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(u.id)}
                                title="Excluir imprevisto"
                                aria-label="Excluir imprevisto"
                                className="p-1.5 text-slate-500 hover:text-rose-400"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ABA 5: MINHA CONTA (ACESSO, SINCRONIZAÇÃO E RESUMO PERTINENTE) */}
        {activeTab === 'nuvem' && (
          <div className="space-y-5">
            {/* Card 1: Acesso e Sincronização na Nuvem */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <User className="w-5 h-5 text-emerald-400" />
                  <div>
                    <h2 className="text-base font-bold text-white">Minha Conta</h2>
                    <p className="text-xs text-slate-400">
                      Entre na sua conta para manter seus lançamentos sincronizados na nuvem entre celular e computador.
                    </p>
                  </div>
                </div>
                <span
                  className={`text-[11px] font-medium px-2.5 py-1 rounded-full border shrink-0 flex items-center gap-1.5 ${
                    userEmail
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-slate-800 border-slate-700 text-slate-400'
                  }`}
                >
                  <Cloud className="w-3.5 h-3.5" />
                  {userEmail ? 'Nuvem Ativa' : 'Modo Local'}
                </span>
              </div>

              {authStatus && (
                <div className="p-3 rounded-xl bg-slate-950 border border-emerald-500/40 text-xs text-emerald-300">
                  {authStatus}
                </div>
              )}

              {/* Se já estiver logado */}
              {userEmail ? (
                <div className="space-y-3 bg-slate-950 border border-slate-800 p-4 rounded-xl">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="text-xs text-slate-400 block">Conta conectada:</span>
                      <span className="text-sm font-bold text-emerald-400">{userEmail}</span>
                    </div>
                    <button
                      onClick={handleLogout}
                      className="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-2 rounded-lg transition"
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
                      {syncing ? 'Sincronizando...' : 'Sincronizar Dados com a Nuvem'}
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
                      : 'Criar Conta'}
                  </button>
                </form>
              )}
            </div>

            {/* Card 2: Resumo dos Dados & Backup */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-white">Resumo da Sua Rotina & Moto</h3>
                  <p className="text-xs text-slate-400">
                    Visão rápida dos parâmetros e registros salvos na sua conta.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('custos')}
                  className="text-xs text-emerald-400 hover:underline font-medium shrink-0"
                >
                  Editar moto →
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-slate-950 border border-slate-800 p-3.5 rounded-xl">
                  <span className="text-[11px] text-slate-400 block">Moto Configurada</span>
                  <span className="text-sm font-bold text-white mt-0.5 block truncate">
                    {settings.bike_name}
                  </span>
                  <span className="text-[11px] text-emerald-400">
                    {settings.fuel_consumption_km_l} km/L • {formatBRL(settings.fuel_price_per_liter)}/L
                  </span>
                </div>

                <div className="bg-slate-950 border border-slate-800 p-3.5 rounded-xl">
                  <span className="text-[11px] text-slate-400 block">Custo Total / KM</span>
                  <span className="text-sm font-bold text-amber-400 mt-0.5 block">
                    {formatBRL(totalFixedCostPerKm)}/km
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {maintenanceItems.length} peças ativas
                  </span>
                </div>

                <div className="bg-slate-950 border border-slate-800 p-3.5 rounded-xl">
                  <span className="text-[11px] text-slate-400 block">Dias Registrados</span>
                  <span className="text-sm font-bold text-white mt-0.5 block">
                    {sortedDailyLogs.length} dias
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Último KM: {latestKmEnd > 0 ? `${latestKmEnd} km` : '—'}
                  </span>
                </div>

                <div className="bg-slate-950 border border-slate-800 p-3.5 rounded-xl">
                  <span className="text-[11px] text-slate-400 block">Imprevistos</span>
                  <span className="text-sm font-bold text-rose-400 mt-0.5 block">
                    {unexpectedExpenses.length} registros
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Total: {formatBRL(unexpectedExpenses.reduce((acc, u) => acc + u.amount, 0))}
                  </span>
                </div>
              </div>

              <div className="pt-1 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800">
                <span className="text-xs text-slate-400">
                  Cópia de segurança local dos seus lançamentos e configurações:
                </span>
                <button
                  type="button"
                  onClick={handleExportBackup}
                  className="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3.5 py-2 rounded-lg border border-slate-700 transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  Exportar Backup (.json)
                </button>
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
            <User className="w-5 h-5" />
            <span>Minha Conta</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
