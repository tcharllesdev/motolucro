import { BikeSettings, MaintenanceItem, DailyLog, UnexpectedExpense } from './types';

export const DEFAULT_BIKE_SETTINGS: BikeSettings = {
  bike_name: 'Moto Exemplo (160cc)',
  fuel_consumption_km_l: 35.0,
  fuel_price_per_liter: 6.0,
};

export const DEFAULT_MAINTENANCE_ITEMS: MaintenanceItem[] = [
  { id: 'demo-maint-1', name: 'Óleo do Motor', cost: 60.0, duration_km: 1000 },
  { id: 'demo-maint-2', name: 'Pastilha de Freio', cost: 80.0, duration_km: 8000 },
  { id: 'demo-maint-3', name: 'Kit Relação', cost: 280.0, duration_km: 20000 },
  { id: 'demo-maint-4', name: 'Pneus (Par)', cost: 520.0, duration_km: 18000 },
];

export const DEFAULT_UNEXPECTED_EXPENSES: UnexpectedExpense[] = [];

export const SEED_DAILY_LOGS: DailyLog[] = [
  {
    id: 'demo-log-1',
    log_date: '2025-01-10',
    earnings: 180.0,
    km_start: 10000.0,
    km_end: 10120.0,
    km_total: 120.0,
    start_time: '09:00',
    end_time: '15:00',
    notes: 'Exemplo demonstrativo',
  },
  {
    id: 'demo-log-2',
    log_date: '2025-01-11',
    earnings: 220.0,
    km_start: 10120.0,
    km_end: 10260.0,
    km_total: 140.0,
    start_time: '10:00',
    end_time: '18:00',
    notes: 'Exemplo demonstrativo',
  },
  {
    id: 'demo-log-3',
    log_date: '2025-01-12',
    earnings: 160.0,
    km_start: 10260.0,
    km_end: 10360.0,
    km_total: 100.0,
    start_time: '13:00',
    end_time: '17:00',
    notes: 'Exemplo demonstrativo',
  },
  {
    id: 'demo-log-4',
    log_date: '2025-01-13',
    earnings: 200.0,
    km_start: 10360.0,
    km_end: 10490.0,
    km_total: 130.0,
    start_time: '',
    end_time: '',
    notes: 'Exemplo demonstrativo (sem horário)',
  },
];
