import { createClient, SupabaseClient } from '@supabase/supabase-js';

const STORAGE_URL_KEY = 'motolucro_supabase_url';
const STORAGE_ANON_KEY = 'motolucro_supabase_anon_key';

const DEFAULT_PROJECT_URL = 'https://acrpfisrulqqruwbfopz.supabase.co';
const DEFAULT_PUBLISHABLE_KEY = 'sb_publishable_TXJCp5UNHoE53HGvGbzTGw_YLr9_SPl';

export function getSupabaseCredentials() {
  const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  const localUrl = localStorage.getItem(STORAGE_URL_KEY) || '';
  const localKey = localStorage.getItem(STORAGE_ANON_KEY) || '';

  const url = (envUrl && !envUrl.includes('seu-projeto')) ? envUrl : (localUrl || DEFAULT_PROJECT_URL);
  const anonKey = (envKey && !envKey.includes('sua-anon-key')) ? envKey : (localKey || DEFAULT_PUBLISHABLE_KEY);

  return {
    url: url.trim(),
    anonKey: anonKey.trim(),
    isConfigured: Boolean(url.trim() && anonKey.trim()),
  };
}

export function saveSupabaseCredentials(url: string, anonKey: string) {
  localStorage.setItem(STORAGE_URL_KEY, url.trim());
  localStorage.setItem(STORAGE_ANON_KEY, anonKey.trim());
}

export function clearSupabaseCredentials() {
  localStorage.removeItem(STORAGE_URL_KEY);
  localStorage.removeItem(STORAGE_ANON_KEY);
}

let cachedClient: SupabaseClient | null = null;
let cachedSignature = '';

export function getSupabaseClient(): SupabaseClient | null {
  const { url, anonKey, isConfigured } = getSupabaseCredentials();
  if (!isConfigured) return null;

  const sig = `${url}::${anonKey}`;
  if (!cachedClient || cachedSignature !== sig) {
    try {
      cachedClient = createClient(url, anonKey);
      cachedSignature = sig;
    } catch {
      return null;
    }
  }
  return cachedClient;
}
