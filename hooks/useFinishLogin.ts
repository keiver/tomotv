import { useLibrary } from "@/contexts/LibraryContext";
import { clearFolderContentsCache } from "@/services/folderContentsCache";
import { useRouter } from "expo-router";
import { useCallback } from "react";

/**
 * The tail every login path shares, whichever screen performed it: Quick Connect,
 * username and password, or the demo server.
 *
 * The order matters. Refreshing the library and clearing the folder cache both
 * complete before the navigation, so the Library root can't race the auth-change
 * remounts and paint the previous session's content.
 */
export function useFinishLogin() {
  const { refreshLibrary } = useLibrary();
  const router = useRouter();

  return useCallback(async () => {
    await refreshLibrary();
    clearFolderContentsCache();
    // dismissTo, NOT navigate. This has to UNWIND to the tabs, and navigate stopped doing that:
    // its NAVIGATE action only reuses a route already on the stack when that route is the one
    // currently on top, or when the payload carries `pop` — neither is true here, so the router
    // fell through to its push branch (StackRouter.js:188-197, 244) and stacked a SECOND (tabs)
    // route ON TOP of the connect stack. The login looked finished, and one Menu press from the
    // Library walked straight back into a freshly-mounted, empty Quick Connect screen.
    //
    // dismissTo dispatches POP_TO instead, which walks back to the existing (tabs) route and
    // truncates everything above it (StackRouter.js:336-400). The tab still changes to Library:
    // POP_TO hands the route a new params object carrying `screen: "(library)"`, and an unconsumed
    // nested-params object makes the mounted tab navigator navigate there
    // (useNavigationBuilder.js:415-434). Popping to a route that is already current is a no-op, so
    // the demo login — which never pushes a step — is unaffected.
    router.dismissTo("/");
  }, [refreshLibrary, router]);
}
