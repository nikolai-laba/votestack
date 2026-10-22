// The app version, written in at build time from package.json's version
// (vite.config.ts), so the footer follows each release's version bump.

declare const __APP_VERSION__: string

export const APP_VERSION = __APP_VERSION__
