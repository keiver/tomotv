import { ConnectStepScreen } from "@/components/settings/ConnectStepScreen";
import { UsernamePasswordSection } from "@/components/settings/UsernamePasswordSection";
import { useFinishLogin } from "@/hooks/useFinishLogin";
import { authenticateByName, generateDeviceId, getSavedAccounts, saveAuthResult } from "@/services/jellyfinApi";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useRef, useState } from "react";
import { Alert, TextInput } from "react-native";

/**
 * Username and password step.
 *
 * Reached either straight from the server list (servers with Quick Connect off) or
 * from the Quick Connect step, and in both cases Menu (TV) and the nav bar's back
 * button (phone) return to wherever it was pushed from. No menu handlers, no back
 * handlers — see the screen options in app/_layout.tsx.
 */
export default function LoginScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ url: string; name?: string; serverId?: string; username?: string }>();
  const finishLogin = useFinishLogin();

  // Prefilled when a saved account's token expired and only the password is needed.
  const [username, setUsername] = useState(params.username ?? "");
  const [password, setPassword] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const usernameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const serverName = params.name ?? "";

  const handleSignIn = async () => {
    const trimmedUser = username.trim();
    if (!trimmedUser) {
      Alert.alert("Missing Username", "Please enter your username.");
      return;
    }

    setIsSigningIn(true);
    try {
      const cleanUrl = params.url.trim().replace(/\/+$/, "");
      // Re-signing into a saved account keeps its device identity (its replacement
      // token lands on the same server-side device); anyone else gets a fresh one,
      // since Jellyfin allows one token per DeviceId per server.
      const saved = params.serverId ? (await getSavedAccounts()).find((a) => a.serverId === params.serverId && a.userName.toLowerCase() === trimmedUser.toLowerCase()) : undefined;
      const deviceId = saved?.deviceId ?? generateDeviceId();
      const auth = await authenticateByName(cleanUrl, trimmedUser, password, deviceId);
      await saveAuthResult(cleanUrl, auth.AccessToken, auth.User.Id, auth.User.Name, serverName, "password", params.serverId, deviceId);
      await finishLogin();
    } catch (error) {
      Alert.alert("Sign In Failed", error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <ConnectStepScreen header={`Sign in into ${serverName || "Jellyfin server"}`.toUpperCase()} centered>
      <UsernamePasswordSection
        username={username}
        setUsername={setUsername}
        password={password}
        setPassword={setPassword}
        usernameRef={usernameRef}
        passwordRef={passwordRef}
        isSigningIn={isSigningIn}
        onSignIn={handleSignIn}
        onBack={() => router.back()}
      />
    </ConnectStepScreen>
  );
}
