import { BikeSettings, MaintenanceItem, DailyLog, UnexpectedExpense } from './types';

export type GrossPerKmTier = 'low' | 'medium' | 'high';

export function getGrossPerKmTier(grossPerKm: number): GrossPerKmTier {
  if (!Number.isFinite(grossPerKm)) return 'low';
  const rounded = Math.round(grossPerKm * 100) / 100;
  if (rounded < 1.5) return 'low';
  if (rounded < 2.0) return 'medium';
  return 'high';
}

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
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function ensureValidUuid(id?: string | null): string {
  if (id && UUID_REGEX.test(id)) return id;
  return generateUuid();
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

export interface PeriodSummaryStats {
  daysCount: number;
  totalGross: number;
  totalKm: number;
  totalHours: number;
  totalFuel: number;
  totalMaint: number;
  totalUnexpected: number;
  totalCost: number;
  netProfit: number;
  avgGrossPerKm: number;
  avgNetPerKm: number;
  avgGrossPerHour: number;
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

export function calculatePeriodSummary(
  logs: DailyLog[],
  settings: BikeSettings,
  maintenanceItems: MaintenanceItem[],
  unexpectedExpenses: UnexpectedExpense[],
  selectedMonth: string = 'all'
): PeriodSummaryStats {
  let totalGross = 0;
  let totalGrossWithValidHours = 0;
  let totalKm = 0;
  let totalHours = 0;
  let totalFuel = 0;
  let totalMaint = 0;

  logs.forEach((l) => {
    const m = calculateDayMetrics(l, settings, maintenanceItems, []);
    totalGross += m.grossEarnings;
    totalKm += m.kmRodado;
    totalHours += m.hoursWorked;
    if (m.hoursWorked > 0) {
      totalGrossWithValidHours += m.grossEarnings;
    }
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
  const avgGrossPerHour = totalHours > 0 ? totalGrossWithValidHours / totalHours : 0;

  return {
    daysCount: logs.length,
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
    maximumFractionDigits: 2,
  });
}

export function formatDateBR(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

const WEEKDAYS = [
  'domingo',
  'segunda',
  'terça',
  'quarta',
  'quinta',
  'sexta',
  'sábado',
] as const;

/**
 * Retorna o nome curto/informal do dia da semana (ex: 'quinta', 'sexta', 'sábado')
 * a partir de uma data no formato YYYY-MM-DD, evitando problemas de fuso horário UTC.
 */
export function getWeekdayName(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return '';
  const [year, month, day] = parts.map(Number);
  if (!year || !month || !day) return '';
  const date = new Date(year, month - 1, day);
  return WEEKDAYS[date.getDay()] ?? '';
}

/**
 * Retorna a data no formato brasileiro com o dia da semana entre parênteses.
 * Exemplo: '19/11/2026 (quinta)'
 */
export function formatDateWithWeekday(dateStr: string): string {
  const formatted = formatDateBR(dateStr);
  const weekday = getWeekdayName(dateStr);
  return weekday ? `${formatted} (${weekday})` : formatted;
}
