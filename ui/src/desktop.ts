// What the Electron preload (desktop/preload.cjs) exposes to the UI; absent in a plain browser.
export type CentralLibraryRead = { status: 'ok'; json: string | null } | { status: 'busy' };

declare global {
  interface Window {
    reforge?: {
      /** The old Central library from the desktop's storage, read once for the migration. */
      centralLibrary?: () => Promise<CentralLibraryRead>;
    };
  }
}
