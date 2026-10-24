interface AuthState {
  isReady: boolean;
  isConnected: boolean;
}

interface DownloadsState {
  hydrated: boolean;
  readyCount: number;
}

/**
 * Whether the tabs are in the root stack. They leave it only once both reads are in and the
 * device is signed out with nothing downloaded, so the Who's watching screen becomes the root.
 */
export function tabsAvailable(auth: AuthState, downloads: DownloadsState): boolean {
  return !auth.isReady || auth.isConnected || !downloads.hydrated || downloads.readyCount > 0;
}

interface Unwinder {
  dismissAll: () => void;
  dismissTo: (href: "/") => void;
}

/**
 * Land on the Library root after a login. The pop to the stack's first route comes first: a pop
 * to a route that is not on the stack cuts the stack at the current index and appends it, so
 * from the connect steps pushed over Who's watching a bare dismissTo would leave those steps
 * under the tabs.
 */
export function unwindToLibrary(router: Unwinder): void {
  router.dismissAll();
  router.dismissTo("/");
}
