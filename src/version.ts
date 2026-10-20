// The app version, written in at build time from the VERSION file
// (vite.config.ts), so a release only changes VERSION and the footer follows.

declare const __APP_VERSION__: string

export const APP_VERSION = __APP_VERSION__
