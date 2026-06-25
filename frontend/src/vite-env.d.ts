/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend API origin for the deployed build, e.g. https://your-backend.onrender.com */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
