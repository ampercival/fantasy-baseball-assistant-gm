/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL, e.g. https://<ref>.supabase.co */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase publishable/anon key (safe to expose; protected by RLS). */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Base path for the GitHub Pages build (project site), e.g. /<repo>/. */
  readonly VITE_BASE_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
