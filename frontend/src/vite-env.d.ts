/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend API origin for the deployed build, e.g. https://your-backend.onrender.com */
  readonly VITE_API_URL?: string;
  /** Supabase project URL, e.g. https://<ref>.supabase.co */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase publishable/anon key (safe to expose; protected by RLS). */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
