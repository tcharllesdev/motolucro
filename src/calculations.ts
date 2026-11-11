import { BikeSettings, MaintenanceItem, DailyLog, UnexpectedExpense } from './types';

export function calcHoursWorked(startTime?: string, endTime?: string): number {
  if (!startTime || !endTime) return 0;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return 0;

  let startMins = sh * 60 + sm;
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
