import { createLocalBackend } from './local';
import type { Backend } from './types';

export type { Backend, AuthUser } from './types';
export { BackendError } from './types';

declare global {
  interface Window {
    SURVEY_STUDIO_CONFIG?: { supabaseUrl?: string; supabaseAnonKey?: string };
  }
}

export interface AppConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

/** Reads the Supabase settings from build-time variables or public/config.js. */
export function readConfig(): AppConfig {
  const runtime = typeof window !== 'undefined' ? window.SURVEY_STUDIO_CONFIG : undefined;
  return {
    supabaseUrl: String(import.meta.env.VITE_SUPABASE_URL || runtime?.supabaseUrl || '').trim(),
    supabaseAnonKey: String(import.meta.env.VITE_SUPABASE_ANON_KEY || runtime?.supabaseAnonKey || '').trim(),
  };
}

let instance: Promise<Backend> | null = null;

/** The storage backend for this deployment, chosen once at start-up. */
export function getBackend(): Promise<Backend> {
  if (!instance) {
    const cfg = readConfig();
    instance =
      cfg.supabaseUrl && cfg.supabaseAnonKey
        ? import('./supabase').then((m) => m.createSupabaseBackend(cfg.supabaseUrl, cfg.supabaseAnonKey))
        : Promise.resolve(createLocalBackend());
  }
  return instance;
}
