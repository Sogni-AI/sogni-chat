/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

declare module 'virtual:changelog' {
  interface ChangelogChange {
    type: string;
    text: string;
  }
  interface ChangelogEntry {
    version: string;
    date: string;
    changes: ChangelogChange[];
  }
  const entries: ChangelogEntry[];
  export default entries;
}
