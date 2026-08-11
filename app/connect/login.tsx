import { ConnectStepScreen } from "@/components/settings/ConnectStepScreen";
import { UsernamePasswordSection } from "@/components/settings/UsernamePasswordSection";
import { useFinishLogin } from "@/hooks/useFinishLogin";
import { authenticateByName, saveAuthResult } from "@/services/jellyfinApi";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useRef, useState } from "react";
import { Alert, TextInput } from "react-native";

/**
 * Username and password step.
 *
 * Reached either straight from the server list (servers with Quick Connect off) or
 * from the Quick Connect step, and in both cases Menu pops back to wherever it was
 * pushed from. No menu handlers — see app/connect/_layout.tsx.
 */
export default function LoginScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ url: string; name?: string; serverId?: string }>();
  const finishLogin = useFinishLogin();

  const [username, setUsername] = useState("");
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
      const auth = await authenticateByName(cleanUrl, trimmedUser, password);
      await saveAuthResult(cleanUrl, auth.AccessToken, auth.User.Id, auth.User.Name, serverName, "password", params.serverId);
      await finishLogin();
    } catch (error) {
      Alert.alert("Sign In Failed", error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <ConnectStepScreen header="JELLYFIN SERVER" centered>
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
        onSwitchToQuickConnect={() =>
          router.push({
            pathname: "/connect/quick-connect",
            params: { url: params.url, name: params.name, serverId: params.serverId },
          })
        }
        serverName={serverName}
      />
    </ConnectStepScreen>
  );
}
