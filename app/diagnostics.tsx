import { AmbientBackground } from "@/components/ambient-background";
import { FocusableButton } from "@/components/FocusableButton";
import { PillSwitch } from "@/components/settings/PillSwitch";
import { SectionFooter } from "@/components/settings/SectionFooter";
import { settingsStyles } from "@/components/settings/styles";
import { COLORS } from "@/constants/colors";
import { buildLog, logText } from "@/services/diagnosticsLog";
import { readSentSession, sendSession, type SentSession } from "@/services/diagnosticsOutbox";
import { shareLog } from "@/services/diagnosticsShare";
import { isAuthenticated } from "@/services/jellyfinApi";
import { readLastSession, type PlaybackSession } from "@/services/playbackProbe";
import { describePlayback, type DeviceName } from "@/services/playbackStory";
import { IS_MAC } from "@/utils/hostEnvironment";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import { Stack, type NativeStackNavigationOptions } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;
const DEVICE: DeviceName = IS_TV ? "Apple TV" : IS_MAC ? "Mac" : Platform.OS === "ios" && Platform.isPad ? "iPad" : "iPhone";

/** Menlo advances 0.6em per glyph, so the JSON's own indent converts to a left inset. Moving
 *  it out of the string is what makes a wrapped line hang under its property instead of
 *  restarting at the card margin. */
const CHAR_WIDTH = (IS_TV ? 18 : 12) * 0.6;
const LINE_INSET = IS_TV ? 20 : 14;
const indentOf = (line: string) => LINE_INSET + (line.length - line.trimStart().length) * CHAR_WIDTH;

type Source = "own" | "sent";
type SendState = "idle" | "sending" | "sent" | "failed";

const SEND_TITLE: Record<SendState, string> = { idle: "Send to iPhone", sending: "Sending", sent: "Sent", failed: "Send to iPhone" };
const SEND_NOTE: Record<SendState, string | null> = { idle: null, sending: null, sent: "Open Diagnostics in Tomo TV on your iPhone.", failed: "Could not reach your server. Try again." };

/**
 * The most recent playback, as the engine recorded it. The page itself never scrolls: the
 * log card takes whatever height is left under the title and scrolls inside that, so the
 * biggest possible slab of log is on screen at once.
 */
export default function DiagnosticsScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [own] = useState<PlaybackSession | null>(readLastSession);
  const [sent, setSent] = useState<SentSession | null>(null);
  const [source, setSource] = useState<Source>(own ? "own" : "sent");
  const [copied, setCopied] = useState(false);
  const [sendState, setSendState] = useState<SendState>("idle");
  const connected = isAuthenticated();

  // The phone looks for a session an Apple TV left on the server. tvOS only ever sends.
  useEffect(() => {
    if (IS_TV || !connected) return;
    let active = true;
    readSentSession().then((found) => {
      if (active) setSent(found);
    });
    return () => {
      active = false;
    };
  }, [connected]);

  const showingSent = source === "sent" && sent !== null;
  const session = showingSent ? sent.session : own;
  const device = showingSent ? sent.device : DEVICE;

  // The head is the build that recorded the session, not necessarily the one running.
  const blocks = useMemo(() => (session ? buildLog(session, session) : []), [session]);
  const story = useMemo(() => (session ? describePlayback(session, device, !showingSent) : null), [session, device, showingSent]);
  const text = useMemo(() => logText(blocks, story), [story, blocks]);

  // Required inside the handler, never at module scope: expo-clipboard's podspec is iOS and
  // macOS only, so evaluating it on tvOS throws before this route can render anything.
  const copy = useCallback(async () => {
    try {
      const Clipboard = await import("expo-clipboard");
      await Clipboard.setStringAsync(text);
      setCopied(true);
    } catch (error) {
      logger.warn("Clipboard unavailable", error, { service: "Diagnostics" });
    }
  }, [text]);

  const share = useCallback(async () => {
    try {
      await shareLog(text, `Tomo TV diagnostics, ${device}.txt`);
    } catch (error) {
      logger.warn("Share unavailable", error, { service: "Diagnostics" });
    }
  }, [text, device]);

  const send = useCallback(async () => {
    if (!own || sendState === "sending") return;
    setSendState("sending");
    try {
      await sendSession(own, DEVICE);
      setSendState("sent");
    } catch (error) {
      logger.warn("Diagnostics send failed", error, { service: "Diagnostics" });
      setSendState("failed");
    }
  }, [own, sendState]);

  const switchSource = useCallback((next: Source) => {
    setSource(next);
    setCopied(false);
  }, []);

  // Phone only, as custom items: a UIBarButtonItem shows its image or its title, never both.
  // tvOS has no pasteboard or share sheet a viewer can reach and no header, so it gets nothing.
  const screenOptions = useMemo<NativeStackNavigationOptions>(
    () => ({
      unstable_headerRightItems: () =>
        session
          ? [
              {
                type: "custom",
                element: (
                  <FocusableButton
                    title="Share"
                    variant="link"
                    icon={<Ionicons name="share-outline" size={16} color={COLORS.ACCENT} />}
                    onPress={share}
                    accessibilityLabel="Share the diagnostics log as a file"
                  />
                ),
              },
              {
                type: "custom",
                element: (
                  <FocusableButton
                    title={copied ? "Copied" : "Copy"}
                    variant="link"
                    icon={<Ionicons name={copied ? "checkmark" : "copy-outline"} size={16} color={COLORS.ACCENT} />}
                    onPress={copy}
                    accessibilityLabel="Copy the diagnostics log"
                  />
                ),
              },
            ]
          : [],
    }),
    [session, copied, copy, share],
  );

  const footer = showingSent
    ? `Sent from your ${sent.device} on ${new Date(sent.sentAt).toLocaleString()}, through your Jellyfin server.`
    : IS_TV
      ? "One session is kept. Send to iPhone stores it on your Jellyfin server, under your account, for Tomo TV on your iPhone."
      : `The last playback as the engine recorded it. One session is kept on this ${DEVICE}.`;

  return (
    <View style={settingsStyles.screenContainer}>
      {!IS_TV && <Stack.Screen options={screenOptions} />}
      <AmbientBackground />
      <View style={[styles.page, { paddingTop: IS_TV ? 40 + insets.top : headerHeight + 12, paddingBottom: (IS_TV ? 60 : 24) + insets.bottom }]}>
        <View style={[settingsStyles.contentContainer, styles.column]}>
          {/* Phone puts this in the native bar; TV has no header, so it keeps the page title. */}
          {IS_TV && <Text style={styles.title}>Diagnostics</Text>}

          {own && sent && (
            <PillSwitch
              options={[
                { key: "own", label: `This ${DEVICE}` },
                { key: "sent", label: `${sent.device}, ${new Date(sent.sentAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` },
              ]}
              value={source}
              onChange={switchSource}
              accessibilityLabel="Which playback to show"
            />
          )}

          {/* Focusable on TV even with nothing to read: a pushed screen with no focusable view
              never takes focus, and Menu then reaches the tab bar and exits instead of popping. */}
          {!session && (
            <Pressable isTVSelectable={IS_TV} hasTVPreferredFocus={IS_TV} accessibilityRole="text" style={({ focused }) => [settingsStyles.section, styles.empty, focused && styles.emptyFocused]}>
              <Ionicons name="film-outline" size={IS_TV ? 44 : 32} color={COLORS.TEXT_QUATERNARY} />
              <Text style={styles.emptyTitle}>Nothing has played yet</Text>
              <Text style={styles.emptyBody}>Play something and come back. This screen will show the lane the engine chose, the stream it opened, and anything that went wrong.</Text>
            </Pressable>
          )}

          {session && (
            <View style={[settingsStyles.section, styles.log]}>
              {/* The plain-words reading as the card's header band: what scrolls under it is the
                  evidence, this is the answer. */}
              {story && <Text style={[settingsStyles.sectionNote, styles.story]}>{story}</Text>}
              <ScrollView style={styles.logScroll} contentContainerStyle={styles.logContent} showsVerticalScrollIndicator={!IS_TV} nestedScrollEnabled>
                {/* No horizontal scroll: long lines wrap instead, so a row can never grow wider
                    than the card and the heading bands stay flush with both edges. */}
                {blocks.map((block, blockIndex) => (
                  <View key={blockIndex}>
                    {block.event && (
                      <View style={styles.band}>
                        <Text style={styles.bandName}>{block.event.name}</Text>
                        <Text style={styles.bandTime}>{block.event.time}</Text>
                      </View>
                    )}
                    {block.lines.map((line, lineIndex) =>
                      // TV wraps each line in a focusable so the remote can walk the log and drag
                      // the scroll with it. Phone leaves the text bare, because a Pressable over it
                      // swallows the long press that starts a selection.
                      IS_TV ? (
                        <Pressable
                          key={lineIndex}
                          isTVSelectable
                          hasTVPreferredFocus={blockIndex === 0 && lineIndex === 0}
                          accessibilityRole="text"
                          style={({ focused }) => [styles.lineRow, { paddingLeft: indentOf(line) }, focused && styles.lineRowFocused]}>
                          {({ focused }) => <Text style={[styles.line, focused && styles.lineFocused]}>{line.trimStart() || " "}</Text>}
                        </Pressable>
                      ) : (
                        <Text key={lineIndex} selectable style={[styles.line, styles.lineRow, { paddingLeft: indentOf(line) }]}>
                          {line.trimStart() || " "}
                        </Text>
                      ),
                    )}
                  </View>
                ))}
              </ScrollView>
              <SectionFooter>
                <Text style={settingsStyles.sectionNote}>{footer}</Text>
              </SectionFooter>
            </View>
          )}

          {IS_TV && own && connected && (
            <View style={styles.sendRow}>
              <FocusableButton
                title={SEND_TITLE[sendState]}
                variant="secondary"
                isLoading={sendState === "sending"}
                onPress={send}
                accessibilityLabel="Send this log to Tomo TV on your iPhone through your Jellyfin server"
              />
              {SEND_NOTE[sendState] && <Text style={styles.sendNote}>{SEND_NOTE[sendState]}</Text>}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: "center" },
  column: { flex: 1 },
  title: { fontSize: IS_TV ? 44 : 28, fontWeight: "800", color: COLORS.TEXT_PRIMARY, letterSpacing: -1, marginBottom: IS_TV ? 24 : 6, marginLeft: IS_TV ? 16 : 8 },
  // The note band, but in the active gold and a step larger: it is the answer, not a footnote.
  story: { color: COLORS.ACCENT, fontSize: IS_TV ? 22 : 14, lineHeight: IS_TV ? 30 : 20 },
  // flex: 1 is the whole point: the card eats the height the heading did not.
  log: { flex: 1, backgroundColor: COLORS.MEDIA_BACKGROUND },
  logScroll: { flex: 1 },
  logContent: { paddingVertical: IS_TV ? 21 : 15 },
  // Edge to edge on purpose: the band is the separator, so it carries no side inset.
  band: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: COLORS.TERMINAL_BAND,
    paddingVertical: IS_TV ? 6 : 3,
    paddingHorizontal: IS_TV ? 20 : 14,
    marginTop: IS_TV ? 14 : 8,
    marginBottom: IS_TV ? 6 : 3,
  },
  bandName: { fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }), fontSize: IS_TV ? 17 : 11, fontWeight: "700", color: COLORS.TERMINAL_BAND_INK },
  bandTime: { fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }), fontSize: IS_TV ? 15 : 10, color: COLORS.TERMINAL_BAND_INK },
  lineRow: { paddingRight: IS_TV ? 20 : 14, paddingVertical: IS_TV ? 3 : 1 },
  lineRowFocused: { backgroundColor: COLORS.SURFACE_RAISED },
  line: { fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }), fontSize: IS_TV ? 18 : 12, lineHeight: IS_TV ? 26 : 18, color: IS_TV ? COLORS.TERMINAL_INK_DIM : COLORS.TERMINAL_INK },
  lineFocused: { color: COLORS.TERMINAL_INK },
  sendRow: { alignItems: "center", gap: 12, marginTop: 24 },
  sendNote: { fontSize: 20, color: COLORS.TEXT_SECONDARY },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 24 },
  emptyFocused: { backgroundColor: COLORS.SURFACE_RAISED },
  emptyTitle: { fontSize: IS_TV ? 26 : 18, fontWeight: "700", color: COLORS.TEXT_BRIGHT },
  emptyBody: { fontSize: IS_TV ? 20 : 13, color: COLORS.TEXT_SECONDARY, textAlign: "center", lineHeight: IS_TV ? 28 : 19 },
});
