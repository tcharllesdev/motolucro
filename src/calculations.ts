import { BikeSettings, MaintenanceItem, DailyLog, UnexpectedExpense } from './types';

export function getLocalTodayStr(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function ensureValidUuid(id: string): string {
  if (UUID_REGEX.test(id)) return id;
  // Converte IDs legados (ex: "seed-1", "maint-1") em um UUID determinístico válido para o PostgreSQL
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  const hex = hash.toString(16).padStart(8, '0');
  const suffix = Array.from(id)
    .map((ch) => ch.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
    .padEnd(12, '0')
    .slice(0, 12);
  return `${hex}-0000-4000-8000-${suffix}`;
}

export function sortDailyLogsDesc(logs: DailyLog[]): DailyLog[] {
  return [...logs].sort((a, b) => {
    const dateCmp = b.log_date.localeCompare(a.log_date);
    if (dateCmp !== 0) return dateCmp;
    return (b.km_end || 0) - (a.km_end || 0);
  });
}

export function calcHoursWorked(startTime?: string, endTime?: string): number {
  if (!startTime || !endTime) return 0;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return 0;

  const startMins = sh * 60 + sm;
  let endMins = eh * 60 + em;
  if (endMins < startMins) {
    // Passou da meia-noite
    endMins += 24 * 60;
  }
  const diffHours = (endMins - startMins) / 60;
  return diffHours > 0 ? diffHours : 0;
}

export function calcMaintenanceCostPerKm(items: MaintenanceItem[]): number {
  return items.reduce((acc, item) => {
    if (!item.duration_km || item.duration_km <= 0) return acc;
    return acc + item.cost / item.duration_km;
  }, 0);
}

export function calcFuelCostPerKm(settings: BikeSettings): number {
  if (!settings.fuel_consumption_km_l || settings.fuel_consumption_km_l <= 0) return 0;
  return settings.fuel_price_per_liter / settings.fuel_consumption_km_l;
}

export interface DayMetrics {
  kmRodado: number;
  hoursWorked: number;
  grossEarnings: number;
  grossPerKm: number;
  grossPerHour: number;
  fuelCost: number;
  maintenanceCost: number;
  unexpectedCost: number;
  totalCost: number;
  costPercent: number;
  netProfit: number;
  netPerKm: number;
  netPerHour: number;
}

export function calculateDayMetrics(
  log: DailyLog,
  settings: BikeSettings,
  maintenanceItems: MaintenanceItem[],
  unexpectedExpenses: UnexpectedExpense[] = []
): DayMetrics {
  const kmRodado = log.km_total > 0 ? log.km_total : Math.max(0, log.km_end - log.km_start);
  const hoursWorked = calcHoursWorked(log.start_time, log.end_time);
  const grossEarnings = log.earnings || 0;

  const fuelPerKm = calcFuelCostPerKm(settings);
  const maintPerKm = calcMaintenanceCostPerKm(maintenanceItems);

  const fuelCost = kmRodado * fuelPerKm;
  const maintenanceCost = kmRodado * maintPerKm;

  const unexpectedCost = unexpectedExpenses
    .filter((e) => e.expense_date === log.log_date)
    .reduce((sum, e) => sum + (e.amount || 0), 0);

  const totalCost = fuelCost + maintenanceCost + unexpectedCost;
  const netProfit = grossEarnings - totalCost;

  const grossPerKm = kmRodado > 0 ? grossEarnings / kmRodado : 0;
  const netPerKm = kmRodado > 0 ? netProfit / kmRodado : 0;

  const grossPerHour = hoursWorked > 0 ? grossEarnings / hoursWorked : 0;
  const netPerHour = hoursWorked > 0 ? netProfit / hoursWorked : 0;
  const costPercent = grossEarnings > 0 ? (totalCost / grossEarnings) * 100 : 0;

  return {
    kmRodado,
    hoursWorked,
    grossEarnings,
    grossPerKm,
    grossPerHour,
    fuelCost,
    maintenanceCost,
    unexpectedCost,
    totalCost,
    costPercent,
    netProfit,
    netPerKm,
    netPerHour,
  };
}

export function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatPerKm(value: number): string {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

export function formatDateBR(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}
