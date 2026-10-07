import { CloseOverlayButton } from "@/components/close-overlay-button";
import { PadSheetBackdrop, PadSheetFrame } from "@/components/pad-sheet";
import { SiblingPager } from "@/components/sibling-pager";
import { VideoInfoPanel } from "@/components/video-info-panel";
import { COLORS } from "@/constants/colors";
import { useItemSiblings } from "@/hooks/useItemSiblings";
import { t } from "@/services/i18n";
import { JellyfinItem } from "@/types/jellyfin";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;
const IS_PAD = !IS_TV && Platform.OS === "ios" && Platform.isPad;

/**
 * The info panel route. On iPhone, iPad and Mac the panel drags left and right through its item's
 * neighbours: a video's or song's queue (a series across its seasons), the folder's folders, photos
 * or books, the libraries, the guide's channels. tvOS shows the one panel.
 */
export default function VideoInfoScreen() {
  const { videoId, name, inFolderId, fromResume, timerId, guideProgram } = useLocalSearchParams<{
    videoId: string;
    name?: string;
    inFolderId?: string;
    fromResume?: string;
    timerId?: string;
    guideProgram?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [opened, setOpened] = useState<JellyfinItem | null>(null);
  const siblings = useItemSiblings(opened, inFolderId);
  const ids = useMemo(() => siblings?.map((item) => item.Id) ?? [videoId], [siblings, videoId]);
  const close = useCallback(() => router.back(), [router]);

  // The opened panel keeps the route's params and is the one that reports its item; a sibling
  // shares only the folder the press came from.
  const renderPage = useCallback(
    (id: string, active: boolean) => {
      const panel =
        id === videoId ? (
          <VideoInfoPanel videoId={videoId} name={name} inFolderId={inFolderId} fromResume={fromResume} timerId={timerId} guideProgram={guideProgram} active={active} onReady={setOpened} />
        ) : (
          <VideoInfoPanel videoId={id} name={siblings?.find((item) => item.Id === id)?.Name} inFolderId={inFolderId} active={active} />
        );
      if (!IS_PAD) return panel;
      return (
        <View style={styles.padPage} pointerEvents="box-none">
          <PadSheetFrame onClose={close} closeHint={t("info.closeHint")} fit="center">
            {panel}
          </PadSheetFrame>
        </View>
      );
    },
    [close, fromResume, guideProgram, inFolderId, name, siblings, timerId, videoId],
  );

  if (IS_TV) {
    return <VideoInfoPanel videoId={videoId} name={name} inFolderId={inFolderId} fromResume={fromResume} timerId={timerId} guideProgram={guideProgram} />;
  }

  if (IS_PAD) {
    return (
      <PadSheetBackdrop onClose={close} fit="center">
        <SiblingPager ids={ids} initialId={videoId} renderPage={renderPage} passThrough />
      </PadSheetBackdrop>
    );
  }

  return (
    <View style={styles.sheetRoot}>
      <SiblingPager ids={ids} initialId={videoId} renderPage={renderPage} />
      <CloseOverlayButton onPress={close} style={{ position: "absolute", top: 12, right: 12 + insets.right }} accessibilityHint={t("info.closeHint")} />
    </View>
  );
}

const styles = StyleSheet.create({
  sheetRoot: {
    flex: 1,
    backgroundColor: COLORS.BACKGROUND,
  },
  padPage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
