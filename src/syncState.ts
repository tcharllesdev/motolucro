import {
  BikeSettings,
  DailyLog,
  MaintenanceItem,
  UnexpectedExpense,
} from './types';
import {
  DEFAULT_BIKE_SETTINGS,
  DEFAULT_MAINTENANCE_ITEMS,
  SEED_DAILY_LOGS,
} from './seedData';
import { ensureValidUuid, sortDailyLogsDesc } from './calculations';

export const LS_SETTINGS_KEY = 'motolucro_bike_settings_v1';
export const LS_MAINT_KEY = 'motolucro_maint_items_v1';
export const LS_LOGS_KEY = 'motolucro_daily_logs_v1';
export const LS_UNEXPECTED_KEY = 'motolucro_unexpected_v1';
export const LS_PENDING_SYNC_KEY = 'motolucro_pending_sync_v1';

export type SyncEntityKind = 'maint' | 'log' | 'unexp';

export interface PendingSyncState {
  pendingUserId: string | null; // null quando alterado deslogado; uid quando falhou sync logado
  settingsDirty: boolean;
  upsertMaintIds: string[];
  deleteMaintIds: string[];
  upsertLogIds: string[];
  deleteLogIds: string[];
  upsertUnexpIds: string[];
  deleteUnexpIds: string[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LocalDataSnapshot {
  settings: BikeSettings;
  maintenanceItems: MaintenanceItem[];
  dailyLogs: DailyLog[];
  unexpectedExpenses: UnexpectedExpense[];
}

export interface RemoteDataSnapshot {
  settings: BikeSettings | null;
  maintenanceItems: MaintenanceItem[];
  dailyLogs: DailyLog[];
  unexpectedExpenses: UnexpectedExpense[];
}

export interface MergePendingResult {
  settings: BikeSettings;
  maintenanceItems: MaintenanceItem[];
  dailyLogs: DailyLog[];
  unexpectedExpenses: UnexpectedExpense[];
  pendingSync: PendingSyncState;
}

function getDefaultStorage(): StorageLike | null {
  if (typeof localStorage !== 'undefined') {
    return localStorage;
  }
  return null;
}

function uniqueIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of ids) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function removeId(list: string[], id: string): string[] {
  return list.filter((item) => item !== id);
}

function addUniqueId(list: string[], id: string): string[] {
  const trimmed = id.trim();
  if (!trimmed || list.includes(trimmed)) return list;
  return [...list, trimmed];
}

function getFieldKeys(kind: SyncEntityKind): {
  upsertKey: 'upsertMaintIds' | 'upsertLogIds' | 'upsertUnexpIds';
  deleteKey: 'deleteMaintIds' | 'deleteLogIds' | 'deleteUnexpIds';
} {
  if (kind === 'maint') {
    return { upsertKey: 'upsertMaintIds', deleteKey: 'deleteMaintIds' };
  }
  if (kind === 'log') {
    return { upsertKey: 'upsertLogIds', deleteKey: 'deleteLogIds' };
  }
  return { upsertKey: 'upsertUnexpIds', deleteKey: 'deleteUnexpIds' };
}

function normalizePendingSyncState(
  raw: Partial<PendingSyncState> | null | undefined
): PendingSyncState {
  const upsertMaintIds = uniqueIds(raw?.upsertMaintIds);
  const deleteMaintIds = uniqueIds(raw?.deleteMaintIds).filter(
    (id) => !upsertMaintIds.includes(id)
  );
  const upsertLogIds = uniqueIds(raw?.upsertLogIds);
  const deleteLogIds = uniqueIds(raw?.deleteLogIds).filter(
    (id) => !upsertLogIds.includes(id)
  );
  const upsertUnexpIds = uniqueIds(raw?.upsertUnexpIds);
  const deleteUnexpIds = uniqueIds(raw?.deleteUnexpIds).filter(
    (id) => !upsertUnexpIds.includes(id)
  );

  const normalized: PendingSyncState = {
    pendingUserId:
      typeof raw?.pendingUserId === 'string' && raw.pendingUserId.trim()
        ? raw.pendingUserId.trim()
        : null,
    settingsDirty: Boolean(raw?.settingsDirty),
    upsertMaintIds,
    deleteMaintIds,
    upsertLogIds,
    deleteLogIds,
    upsertUnexpIds,
    deleteUnexpIds,
  };

  if (!hasPendingSyncChanges(normalized)) {
    return {
      ...normalized,
      pendingUserId: null,
    };
  }

  return normalized;
}

export function createEmptyPendingSyncState(
  pendingUserId: string | null = null
): PendingSyncState {
  return {
    pendingUserId,
    settingsDirty: false,
    upsertMaintIds: [],
    deleteMaintIds: [],
    upsertLogIds: [],
    deleteLogIds: [],
    upsertUnexpIds: [],
    deleteUnexpIds: [],
  };
}

export function hasPendingSyncChanges(state: PendingSyncState): boolean {
  return (
    state.settingsDirty ||
    state.upsertMaintIds.length > 0 ||
    state.deleteMaintIds.length > 0 ||
    state.upsertLogIds.length > 0 ||
    state.deleteLogIds.length > 0 ||
    state.upsertUnexpIds.length > 0 ||
    state.deleteUnexpIds.length > 0
  );
}

export function countPendingSyncChanges(state: PendingSyncState): number {
  return (
    (state.settingsDirty ? 1 : 0) +
    uniqueIds(state.upsertMaintIds).length +
    uniqueIds(state.deleteMaintIds).length +
    uniqueIds(state.upsertLogIds).length +
    uniqueIds(state.deleteLogIds).length +
    uniqueIds(state.upsertUnexpIds).length +
    uniqueIds(state.deleteUnexpIds).length
  );
}

export function loadPendingSyncState(storage?: StorageLike | null): PendingSyncState {
  const store = storage ?? getDefaultStorage();
  if (!store) return createEmptyPendingSyncState();
  try {
    const raw = store.getItem(LS_PENDING_SYNC_KEY);
    if (!raw) return createEmptyPendingSyncState();
    const parsed = JSON.parse(raw) as Partial<PendingSyncState>;
    return normalizePendingSyncState(parsed);
  } catch {
    return createEmptyPendingSyncState();
  }
}

export function savePendingSyncState(
  state: PendingSyncState,
  storage?: StorageLike | null
): void {
  const store = storage ?? getDefaultStorage();
  if (!store) return;
  try {
    const normalized = normalizePendingSyncState(state);
    store.setItem(LS_PENDING_SYNC_KEY, JSON.stringify(normalized));
  } catch {
    // Ignora falha de quota/storage privado
  }
}

export function clearPendingSyncState(storage?: StorageLike | null): PendingSyncState {
  const store = storage ?? getDefaultStorage();
  if (store) {
    try {
      store.removeItem(LS_PENDING_SYNC_KEY);
    } catch {
      // Ignora erro de storage
    }
  }
  return createEmptyPendingSyncState();
}

export function markSettingsDirty(
  state: PendingSyncState,
  userId?: string | null
): PendingSyncState {
  return {
    ...state,
    pendingUserId: userId ?? state.pendingUserId ?? null,
    settingsDirty: true,
  };
}

export function clearSettingsDirty(state: PendingSyncState): PendingSyncState {
  const next: PendingSyncState = {
    ...state,
    settingsDirty: false,
  };
  return hasPendingSyncChanges(next) ? next : createEmptyPendingSyncState();
}

export function markItemUpsert(
  state: PendingSyncState,
  kind: SyncEntityKind,
  id: string,
  userId?: string | null
): PendingSyncState {
  const trimmed = id.trim();
  if (!trimmed) return state;
  const { upsertKey, deleteKey } = getFieldKeys(kind);
  return {
    ...state,
    pendingUserId: userId ?? state.pendingUserId ?? null,
    [upsertKey]: addUniqueId(state[upsertKey], trimmed),
    [deleteKey]: removeId(state[deleteKey], trimmed),
  };
}

export function clearItemUpsert(
  state: PendingSyncState,
  kind: SyncEntityKind,
  id: string
): PendingSyncState {
  const trimmed = id.trim();
  if (!trimmed) return state;
  const { upsertKey } = getFieldKeys(kind);
  const next: PendingSyncState = {
    ...state,
    [upsertKey]: removeId(state[upsertKey], trimmed),
  };
  return hasPendingSyncChanges(next) ? next : createEmptyPendingSyncState();
}

export function markItemDelete(
  state: PendingSyncState,
  kind: SyncEntityKind,
  id: string,
  userId?: string | null
): PendingSyncState {
  const trimmed = id.trim();
  if (!trimmed) return state;
  const { upsertKey, deleteKey } = getFieldKeys(kind);
  const wasPendingUpsert = state[upsertKey].includes(trimmed);
  const isLoggedOutLocalOnly = !userId && state.pendingUserId === null;

  // Se o item foi criado/editado apenas localmente enquanto deslogado e excluído antes de subir,
  // basta removê-lo da fila de upsert sem criar um delete pendente fantasma.
  if (wasPendingUpsert && isLoggedOutLocalOnly) {
    const next: PendingSyncState = {
      ...state,
      [upsertKey]: removeId(state[upsertKey], trimmed),
    };
    return hasPendingSyncChanges(next) ? next : createEmptyPendingSyncState();
  }

  return {
    ...state,
    pendingUserId: userId ?? state.pendingUserId ?? null,
    [upsertKey]: removeId(state[upsertKey], trimmed),
    [deleteKey]: addUniqueId(state[deleteKey], trimmed),
  };
}

export function clearItemDelete(
  state: PendingSyncState,
  kind: SyncEntityKind,
  id: string
): PendingSyncState {
  const trimmed = id.trim();
  if (!trimmed) return state;
  const { deleteKey } = getFieldKeys(kind);
  const next: PendingSyncState = {
    ...state,
    [deleteKey]: removeId(state[deleteKey], trimmed),
  };
  return hasPendingSyncChanges(next) ? next : createEmptyPendingSyncState();
}

export function setPendingUserId(
  state: PendingSyncState,
  userId: string | null
): PendingSyncState {
  if (!hasPendingSyncChanges(state)) {
    return createEmptyPendingSyncState();
  }
  return {
    ...state,
    pendingUserId: userId,
  };
}

function areSettingsEqual(a: BikeSettings, b: BikeSettings): boolean {
  return (
    (a.bike_name || '') === (b.bike_name || '') &&
    Number(a.fuel_consumption_km_l) === Number(b.fuel_consumption_km_l) &&
    Number(a.fuel_price_per_liter) === Number(b.fuel_price_per_liter)
  );
}

function areMaintenanceEqual(a: MaintenanceItem, b: MaintenanceItem): boolean {
  return (
    (a.name || '') === (b.name || '') &&
    Number(a.cost) === Number(b.cost) &&
    Number(a.duration_km) === Number(b.duration_km)
  );
}

function areDailyLogsEqual(a: DailyLog, b: DailyLog): boolean {
  return (
    (a.log_date || '') === (b.log_date || '') &&
    Number(a.earnings) === Number(b.earnings) &&
    Number(a.km_start) === Number(b.km_start) &&
    Number(a.km_end) === Number(b.km_end) &&
    Number(a.km_total) === Number(b.km_total) &&
    (a.start_time || '') === (b.start_time || '') &&
    (a.end_time || '') === (b.end_time || '') &&
    (a.notes || '') === (b.notes || '')
  );
}

function areUnexpectedEqual(a: UnexpectedExpense, b: UnexpectedExpense): boolean {
  return (
    (a.expense_date || '') === (b.expense_date || '') &&
    (a.description || '') === (b.description || '') &&
    Number(a.amount) === Number(b.amount)
  );
}

function findNonMatchingIds<T extends { id: string }>(
  items: T[],
  demoItems: T[],
  isContentEqual: (a: T, b: T) => boolean
): string[] {
  const remainingDemo = [...demoItems];
  const nonMatchingIds: string[] = [];

  for (const item of items) {
    const demoIdx = remainingDemo.findIndex((demo) => isContentEqual(item, demo));
    if (demoIdx >= 0) {
      remainingDemo.splice(demoIdx, 1);
    } else {
      nonMatchingIds.push(item.id);
    }
  }

  // Caso o usuário tenha removido itens da lista demo sem editar os restantes:
  // marca os restantes se ainda houver itens para subir.
  if (nonMatchingIds.length === 0 && items.length !== demoItems.length && items.length > 0) {
    return items.map((item) => item.id);
  }

  return uniqueIds(nonMatchingIds);
}

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function detectChangesAgainstDemo(
  snapshot: LocalDataSnapshot,
  userId: string | null = null
): PendingSyncState {
  let next = createEmptyPendingSyncState(userId);

  if (!areSettingsEqual(snapshot.settings, DEFAULT_BIKE_SETTINGS)) {
    next = markSettingsDirty(next, userId);
  }

  const changedMaintIds = findNonMatchingIds(
    snapshot.maintenanceItems,
    DEFAULT_MAINTENANCE_ITEMS,
    areMaintenanceEqual
  );
  for (const id of changedMaintIds) {
    next = markItemUpsert(next, 'maint', id, userId);
  }

  const changedLogIds = findNonMatchingIds(
    snapshot.dailyLogs,
    SEED_DAILY_LOGS,
    areDailyLogsEqual
  );
  for (const id of changedLogIds) {
    next = markItemUpsert(next, 'log', id, userId);
  }

  for (const exp of snapshot.unexpectedExpenses) {
    next = markItemUpsert(next, 'unexp', exp.id, userId);
  }

  return next;
}

/**
 * Detecta alterações pré-existentes no localStorage antes do controle de pendências existir.
 * Retorna `null` se `motolucro_pending_sync_v1` já estiver presente no storage.
 */
export function detectLegacyLocalPendingState(
  storage?: StorageLike | null,
  currentData?: Partial<LocalDataSnapshot>
): PendingSyncState | null {
  const store = storage ?? getDefaultStorage();
  if (!store) return null;

  try {
    if (store.getItem(LS_PENDING_SYNC_KEY) !== null) {
      return null;
    }
  } catch {
    return null;
  }

  const rawSettings = store.getItem(LS_SETTINGS_KEY);
  const rawMaint = store.getItem(LS_MAINT_KEY);
  const rawLogs = store.getItem(LS_LOGS_KEY);
  const rawUnexp = store.getItem(LS_UNEXPECTED_KEY);

  let next = createEmptyPendingSyncState(null);

  if (rawSettings !== null) {
    const parsedSettings = currentData?.settings ?? safeParseJson<BikeSettings>(rawSettings);
    if (parsedSettings && !areSettingsEqual(parsedSettings, DEFAULT_BIKE_SETTINGS)) {
      next = markSettingsDirty(next, null);
    }
  }

  if (rawMaint !== null) {
    const parsedMaint =
      currentData?.maintenanceItems ??
      safeParseJson<MaintenanceItem[]>(rawMaint)?.map((m) => ({
        ...m,
        id: ensureValidUuid(m.id),
      })) ??
      null;

    if (Array.isArray(parsedMaint)) {
      const changedMaintIds = findNonMatchingIds(
        parsedMaint,
        DEFAULT_MAINTENANCE_ITEMS,
        areMaintenanceEqual
      );
      for (const id of changedMaintIds) {
        next = markItemUpsert(next, 'maint', id, null);
      }
    }
  }

  if (rawLogs !== null) {
    const parsedLogs =
      currentData?.dailyLogs ??
      safeParseJson<DailyLog[]>(rawLogs)?.map((l) => ({
        ...l,
        id: ensureValidUuid(l.id),
      })) ??
      null;

    if (Array.isArray(parsedLogs)) {
      const changedLogIds = findNonMatchingIds(parsedLogs, SEED_DAILY_LOGS, areDailyLogsEqual);
      for (const id of changedLogIds) {
        next = markItemUpsert(next, 'log', id, null);
      }
    }
  }

  if (rawUnexp !== null) {
    const parsedUnexp =
      currentData?.unexpectedExpenses ??
      safeParseJson<UnexpectedExpense[]>(rawUnexp)?.map((u) => ({
        ...u,
        id: ensureValidUuid(u.id),
      })) ??
      null;

    if (Array.isArray(parsedUnexp)) {
      for (const exp of parsedUnexp) {
        next = markItemUpsert(next, 'unexp', exp.id, null);
      }
    }
  }

  return next;
}

export function initializePendingSyncState(
  storage?: StorageLike | null,
  currentData?: Partial<LocalDataSnapshot>
): PendingSyncState {
  const store = storage ?? getDefaultStorage();
  if (!store) return createEmptyPendingSyncState();

  try {
    if (store.getItem(LS_PENDING_SYNC_KEY) !== null) {
      return loadPendingSyncState(store);
    }
  } catch {
    return createEmptyPendingSyncState();
  }

  const legacy = detectLegacyLocalPendingState(store, currentData);
  if (legacy && hasPendingSyncChanges(legacy)) {
    savePendingSyncState(legacy, store);
    return legacy;
  }

  return createEmptyPendingSyncState();
}

function mergeCollectionWithRemote<T extends { id: string }>(
  localItems: T[],
  remoteItems: T[],
  pendingUpsertIds: string[],
  pendingDeleteIds: string[],
  isContentEqual: (a: T, b: T) => boolean
): {
  merged: T[];
  upsertIds: string[];
  deleteIds: string[];
} {
  const deleteSet = new Set(pendingDeleteIds);
  const remoteMap = new Map<string, T>();
  for (const r of remoteItems) {
    remoteMap.set(r.id, r);
  }

  const mergedMap = new Map<string, T>();
  for (const r of remoteItems) {
    if (!deleteSet.has(r.id)) {
      mergedMap.set(r.id, r);
    }
  }

  const localMap = new Map<string, T>();
  for (const l of localItems) {
    localMap.set(l.id, l);
  }

  const nextUpsertIds: string[] = [];
  for (const id of uniqueIds(pendingUpsertIds)) {
    const localItem = localMap.get(id);
    if (!localItem) continue;
    const remoteItem = remoteMap.get(id);
    if (remoteItem && isContentEqual(localItem, remoteItem)) {
      // Já está idêntico na nuvem; não precisa continuar marcado como pendente.
      continue;
    }
    mergedMap.set(id, localItem);
    nextUpsertIds.push(id);
  }

  // Só mantém exclusão pendente para IDs que realmente existem na nuvem
  const nextDeleteIds = uniqueIds(pendingDeleteIds).filter((id) => remoteMap.has(id));

  return {
    merged: Array.from(mergedMap.values()),
    upsertIds: nextUpsertIds,
    deleteIds: nextDeleteIds,
  };
}

/**
 * Mescla alterações locais feitas antes do login (`pendingUserId === null`) em cima
 * dos dados baixados do Supabase, preservando adições/edições e aplicando exclusões
 * pendentes sem sobrescrever o restante dos registros da nuvem.
 */
export function mergePendingDataWithRemote(
  local: LocalDataSnapshot,
  remote: RemoteDataSnapshot,
  pending: PendingSyncState,
  targetUserId: string
): MergePendingResult {
  const settingsChangedVsRemote =
    pending.settingsDirty &&
    (!remote.settings || !areSettingsEqual(local.settings, remote.settings));

  const mergedSettings = settingsChangedVsRemote
    ? local.settings
    : remote.settings ?? local.settings;

  const maintResult = mergeCollectionWithRemote(
    local.maintenanceItems,
    remote.maintenanceItems,
    pending.upsertMaintIds,
    pending.deleteMaintIds,
    areMaintenanceEqual
  );

  const logsResult = mergeCollectionWithRemote(
    local.dailyLogs,
    remote.dailyLogs,
    pending.upsertLogIds,
    pending.deleteLogIds,
    areDailyLogsEqual
  );

  const unexpResult = mergeCollectionWithRemote(
    local.unexpectedExpenses,
    remote.unexpectedExpenses,
    pending.upsertUnexpIds,
    pending.deleteUnexpIds,
    areUnexpectedEqual
  );

  const nextPendingCandidate: PendingSyncState = {
    pendingUserId: targetUserId,
    settingsDirty: settingsChangedVsRemote,
    upsertMaintIds: maintResult.upsertIds,
    deleteMaintIds: maintResult.deleteIds,
    upsertLogIds: logsResult.upsertIds,
    deleteLogIds: logsResult.deleteIds,
    upsertUnexpIds: unexpResult.upsertIds,
    deleteUnexpIds: unexpResult.deleteIds,
  };

  const nextPending = hasPendingSyncChanges(nextPendingCandidate)
    ? nextPendingCandidate
    : createEmptyPendingSyncState();

  return {
    settings: mergedSettings,
    maintenanceItems: maintResult.merged,
    dailyLogs: sortDailyLogsDesc(logsResult.merged),
    unexpectedExpenses: unexpResult.merged,
    pendingSync: nextPending,
  };
}
