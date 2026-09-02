import { AmbientBackground } from "@/components/ambient-background";
import { FocusableButton } from "@/components/FocusableButton";
import { settingsStyles } from "@/components/settings/styles";
import { APP_VERSION_LABEL } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { buildLog, logText } from "@/services/diagnosticsLog";
import { readLastSession, type PlaybackSession } from "@/services/playbackProbe";
import { describePlayback, type DeviceName } from "@/services/playbackStory";
import { IS_MAC } from "@/utils/hostEnvironment";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;
const LOG_HEAD = { app: APP_VERSION_LABEL, os: `${IS_TV ? "tvOS" : "iOS"} ${Platform.Version}` };
const DEVICE: DeviceName = IS_TV ? "Apple TV" : IS_MAC ? "Mac" : Platform.OS === "ios" && Platform.isPad ? "iPad" : "iPhone";

/** Menlo advances 0.6em per glyph, so the JSON's own indent converts to a left inset. Moving
 *  it out of the string is what makes a wrapped line hang under its property instead of
 *  restarting at the card margin. */
const CHAR_WIDTH = (IS_TV ? 18 : 12) * 0.6;
const LINE_INSET = IS_TV ? 20 : 14;
const indentOf = (line: string) => LINE_INSET + (line.length - line.trimStart().length) * CHAR_WIDTH;

/**
 * The most recent playback, as the engine recorded it. The page itself never scrolls: the
 * log card takes whatever height is left under the heading and scrolls inside that, so the
 * biggest possible slab of log is on screen at once.
 */
export default function DiagnosticsScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [session] = useState<PlaybackSession | null>(readLastSession);
  const [copied, setCopied] = useState(false);

  const blocks = useMemo(() => buildLog(session, LOG_HEAD), [session]);
  const story = useMemo(() => (session ? describePlayback(session, DEVICE) : null), [session]);
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

  return (
    <View style={settingsStyles.screenContainer}>
      <AmbientBackground />
      <View style={[styles.page, { paddingTop: IS_TV ? 40 + insets.top : headerHeight + 12, paddingBottom: (IS_TV ? 60 : 24) + insets.bottom }]}>
        <View style={[settingsStyles.contentContainer, styles.column]}>
          {/* Phone puts this in the native bar; TV has no header, so it keeps the page title. */}
          {IS_TV && <Text style={styles.title}>Diagnostics</Text>}
          <Text style={styles.intro}>What the playback engine did on the most recent playback session. Only the last one is kept and it never leaves this device.</Text>

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
              {/* The plain-words reading as the card's header band, the quality list's footer note
                  turned upside down: what scrolls under it is the evidence, this is the answer. */}
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
            </View>
          )}

          {/* tvOS has no pasteboard a viewer can reach, so the button would promise nothing. */}
          {!IS_TV && session && <FocusableButton title={copied ? "Copied" : "Copy"} variant="secondary" onPress={copy} style={styles.copy} accessibilityLabel="Copy the diagnostics log" />}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: "center" },
  column: { flex: 1 },
  title: { fontSize: IS_TV ? 44 : 28, fontWeight: "800", color: COLORS.TEXT_PRIMARY, letterSpacing: -1, marginBottom: IS_TV ? 10 : 6, marginLeft: IS_TV ? 16 : 8 },
  intro: { fontSize: IS_TV ? 22 : 14, color: COLORS.TEXT_SECONDARY, lineHeight: IS_TV ? 30 : 20, marginBottom: IS_TV ? 24 : 14, marginLeft: IS_TV ? 16 : 8 },
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
  copy: { alignSelf: "center", marginTop: 14 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 24 },
  emptyFocused: { backgroundColor: COLORS.SURFACE_RAISED },
  emptyTitle: { fontSize: IS_TV ? 26 : 18, fontWeight: "700", color: COLORS.TEXT_BRIGHT },
  emptyBody: { fontSize: IS_TV ? 20 : 13, color: COLORS.TEXT_SECONDARY, textAlign: "center", lineHeight: IS_TV ? 28 : 19 },
});
