import { CardDragView } from "@/components/card-drag";
import { PadSheetBackdrop, PadSheetFrame } from "@/components/pad-sheet";
import { SiblingPager } from "@/components/sibling-pager";
import { VideoInfoPanel } from "@/components/video-info-panel";
import { useItemSiblings } from "@/hooks/useItemSiblings";
import { t } from "@/services/i18n";
import { JellyfinItem } from "@/types/jellyfin";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;
// iPad and Mac centre the card; iPhone sets it on the bottom edge.
const FIT = !IS_TV && Platform.OS === "ios" && Platform.isPad ? "center" : "bottom";

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
      // The card centres in the safe area, as its width assumes, so iPhone Duo's side column stays beside it.
      return (
        <View style={[styles.page, FIT === "bottom" && styles.pageBottom, { paddingLeft: insets.left, paddingRight: insets.right }]} pointerEvents="box-none">
          <PadSheetFrame onClose={close} closeHint={t("info.closeHint")} fit={FIT}>
            {panel}
          </PadSheetFrame>
        </View>
      );
    },
    [close, fromResume, guideProgram, inFolderId, insets.left, insets.right, name, siblings, timerId, videoId],
  );

  if (IS_TV) {
    return <VideoInfoPanel videoId={videoId} name={name} inFolderId={inFolderId} fromResume={fromResume} timerId={timerId} guideProgram={guideProgram} />;
  }

  const pager = <SiblingPager ids={ids} initialId={videoId} renderPage={renderPage} passThrough />;
  return (
    <PadSheetBackdrop onClose={close} fit={FIT}>
      {/* iPhone: the card drags down to close, as the player does. */}
      {FIT === "bottom" ? <CardDragView onDismiss={close}>{pager}</CardDragView> : pager}
    </PadSheetBackdrop>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  pageBottom: {
    justifyContent: "flex-end",
  },
});
