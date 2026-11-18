import { createClient, SupabaseClient } from '@supabase/supabase-js';

function sanitizeEnvValue(value: unknown, placeholderFragments: string[]): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  if (placeholderFragments.some((fragment) => lower.includes(fragment))) {
    return '';
  }
  return trimmed;
}

export function getSupabaseCredentials() {
  const url = sanitizeEnvValue(import.meta.env.VITE_SUPABASE_URL, ['seu-projeto']);
  const anonKey = sanitizeEnvValue(import.meta.env.VITE_SUPABASE_ANON_KEY, ['sua-anon-key']);

  return {
    url,
    anonKey,
    isConfigured: Boolean(url && anonKey),
  };
}

let cachedClient: SupabaseClient | null = null;
let cachedSignature = '';

export function getSupabaseClient(): SupabaseClient | null {
  const { url, anonKey, isConfigured } = getSupabaseCredentials();
  if (!isConfigured) {
    cachedClient = null;
    cachedSignature = '';
    return null;
  }

  const sig = `${url}::${anonKey}`;
  if (!cachedClient || cachedSignature !== sig) {
    try {
      cachedClient = createClient(url, anonKey);
      cachedSignature = sig;
    } catch {
      cachedClient = null;
      cachedSignature = '';
      return null;
    }
  }
  return cachedClient;
}
