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
    // Same destination AuthContext uses on an auth change (contexts/AuthContext.tsx),
    // and it also unwinds the connect stack, since that lives at the root.
    router.navigate("/");
  }, [refreshLibrary, router]);
}
