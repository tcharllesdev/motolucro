export interface BikeSettings {
  bike_name: string;
  fuel_consumption_km_l: number;
  fuel_price_per_liter: number;
}

export interface MaintenanceItem {
  id: string;
  name: string;
  cost: number;
  duration_km: number;
}

export interface DailyLog {
  id: string;
  log_date: string; // YYYY-MM-DD
  earnings: number;
  km_start: number;
  km_end: number;
  km_total: number;
  start_time: string; // HH:MM
  end_time: string; // HH:MM
  notes?: string;
}

export interface UnexpectedExpense {
  id: string;
  expense_date: string; // YYYY-MM-DD
  description: string;
  amount: number;
}

export interface TelegramLink {
  user_id: string;
  telegram_user_id: number;
  telegram_chat_id: number;
  telegram_username: string | null;
  telegram_first_name: string | null;
  linked_at: string;
}
