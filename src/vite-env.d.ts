/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly _placeholder?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
declare const __APP_VERSION__: string
