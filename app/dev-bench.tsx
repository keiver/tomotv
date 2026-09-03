import { AmbientBackground } from "@/components/ambient-background";
import { settingsStyles } from "@/components/settings/styles";
import { APP_VERSION_LABEL } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { fetchItemDetails, getVideoStreamUrl } from "@/services/jellyfinApi";
import { benchmarkTranscode, type TranscodeBenchmark } from "@/services/localRemux";
import { logger } from "@/utils/logger";
import { File, Paths } from "expo-file-system";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Read back by scripts/transcode-bench.mjs from the app container. */
export const BENCH_FILENAME = "transcode-bench.json";

const IS_TV = Platform.isTV;

type BenchParams = { items?: string; seconds?: string; decode?: string; run?: string };

export type BenchRow = { itemId: string; title: string; full: TranscodeBenchmark | null; decode: TranscodeBenchmark | null; error?: string };

export type BenchRecord = { run: string; app: string; os: string; startedAt: number; done: boolean; rows: BenchRow[] };

/** Caches, like the session log: tvOS refuses overwrites under Documents. */
function writeRecord(record: BenchRecord): void {
  try {
    const file = new File(Paths.cache, BENCH_FILENAME);
    if (file.exists) file.delete();
    file.create();
    file.write(JSON.stringify(record));
  } catch (error) {
    logger.warn("Bench record write failed", error, { service: "DevBench" });
  }
}

const factor = (result: TranscodeBenchmark | null): string => (result ? (result.failed ? `FAIL (${result.failed})` : `${(result.realtime ?? 0).toFixed(2)}x`) : "-");

/** One rung on one line: what it was, how fast it went, and where the heat went. */
function describe(row: BenchRow): string {
  if (row.error) return `${row.title}  ERROR ${row.error}`;
  const shape = row.full ?? row.decode;
  const size = shape ? `${shape.codec ?? "?"} ${shape.width ?? 0}x${shape.height ?? 0} ${shape.pixFmt ?? ""}` : "";
  const windows = row.full?.windows?.length ? `  ${row.full.windows[0].toFixed(0)}>${row.full.windows[row.full.windows.length - 1].toFixed(0)} fps` : "";
  const thermal = row.full ? `  ${row.full.thermalBefore}>${row.full.thermalAfter}` : "";
  return `${row.title}  ${size}  full ${factor(row.full)}  decode ${factor(row.decode)}${windows}${thermal}`;
}

/**
 * Dev builds only: measures the software-decode lane on this hardware, one item after another,
 * and leaves the record for the driver. tomotv://dev-bench?items=<id,id>&seconds=45&decode=1&run=<tag>
 */
export default function DevBenchScreen() {
  const insets = useSafeAreaInsets();
  const { items, seconds, decode, run } = useLocalSearchParams<BenchParams>();
  const router = useRouter();
  const [rows, setRows] = useState<BenchRow[]>([]);
  const [current, setCurrent] = useState("Starting");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!__DEV__ || !items) {
      router.dismissTo("/");
      return;
    }
    let active = true;
    const ids = items.split(",").filter(Boolean);
    const wallSeconds = Number(seconds) > 0 ? Number(seconds) : 45;
    const record: BenchRecord = { run: run || String(Date.now()), app: APP_VERSION_LABEL, os: `${IS_TV ? "tvOS" : "iOS"} ${Platform.Version}`, startedAt: Date.now(), done: false, rows: [] };
    writeRecord(record);
    void (async () => {
      for (const itemId of ids) {
        if (!active) return;
        const row: BenchRow = { itemId, title: itemId, full: null, decode: null };
        try {
          const item = await fetchItemDetails(itemId);
          if (!item) throw new Error("item not found");
          row.title = item.Name ?? itemId;
          const url = getVideoStreamUrl(itemId, item);
          setCurrent(`${row.title}: decode + encode, ${wallSeconds}s`);
          row.full = await benchmarkTranscode(url, { wallSeconds, encode: true });
          if (decode === "1") {
            setCurrent(`${row.title}: decode only, ${wallSeconds}s`);
            row.decode = await benchmarkTranscode(url, { wallSeconds, encode: false });
          }
        } catch (error) {
          row.error = error instanceof Error ? error.message : String(error);
        }
        record.rows.push(row);
        writeRecord(record);
        if (active) setRows([...record.rows]);
      }
      record.done = true;
      writeRecord(record);
      if (active) {
        setCurrent("Done");
        setDone(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [items, seconds, decode, run, router]);

  return (
    <View style={settingsStyles.screenContainer}>
      <AmbientBackground />
      <View style={[styles.page, { paddingTop: (IS_TV ? 40 : 24) + insets.top, paddingBottom: (IS_TV ? 60 : 24) + insets.bottom }]}>
        <View style={[settingsStyles.contentContainer, styles.column]}>
          <Text style={styles.title}>Transcode bench</Text>
          <View style={[settingsStyles.section, styles.log]}>
            {/* Focusable from the first frame: a pushed screen with nothing focusable sends Menu to
                the tab bar, which exits the app instead of popping. */}
            <Pressable isTVSelectable={IS_TV} hasTVPreferredFocus={IS_TV} accessibilityRole="text">
              <Text style={[settingsStyles.sectionNote, styles.status]}>{current}</Text>
            </Pressable>
            <ScrollView style={styles.logScroll} contentContainerStyle={styles.logContent} showsVerticalScrollIndicator={!IS_TV}>
              {rows.map((row) => (
                <Pressable key={row.itemId} isTVSelectable={IS_TV} accessibilityRole="text" style={({ focused }) => [styles.lineRow, focused && styles.lineRowFocused]}>
                  <Text style={styles.line}>{describe(row)}</Text>
                </Pressable>
              ))}
              {done && (
                <Pressable isTVSelectable={IS_TV} accessibilityRole="text" style={({ focused }) => [styles.lineRow, focused && styles.lineRowFocused]}>
                  <Text style={styles.line}>{`${rows.length} rungs recorded to Caches/${BENCH_FILENAME}`}</Text>
                </Pressable>
              )}
            </ScrollView>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: "center" },
  column: { flex: 1 },
  title: { fontSize: IS_TV ? 44 : 28, fontWeight: "800", color: COLORS.TEXT_PRIMARY, letterSpacing: -1, marginBottom: IS_TV ? 24 : 12, marginHorizontal: 16 },
  log: { flex: 1, backgroundColor: COLORS.MEDIA_BACKGROUND },
  status: { color: COLORS.ACCENT, fontSize: IS_TV ? 22 : 14, lineHeight: IS_TV ? 30 : 20 },
  logScroll: { flex: 1 },
  logContent: { paddingVertical: IS_TV ? 21 : 15 },
  lineRow: { paddingHorizontal: IS_TV ? 20 : 14, paddingVertical: IS_TV ? 3 : 1 },
  lineRowFocused: { backgroundColor: COLORS.SURFACE_RAISED },
  line: { fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }), fontSize: IS_TV ? 18 : 12, lineHeight: IS_TV ? 26 : 18, color: COLORS.TERMINAL_INK },
});
