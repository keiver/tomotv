import { AmbientBackground } from "@/components/ambient-background";
import { FocusableButton } from "@/components/FocusableButton";
import { JoinQr } from "@/components/join-qr";
import { ListRow } from "@/components/settings/ListRow";
import { SectionFooter } from "@/components/settings/SectionFooter";
import { IS_PAD, settingsStyles } from "@/components/settings/styles";
import { COLORS } from "@/constants/colors";
import { checkServerInfo, getConfig, getStoredServerId } from "@/services/jellyfinApi";
import { createGroup, leaveGroup, refreshAccess, refreshGroups, resumeGroupPlayback, subscribe, switchGroup, SyncPlaySnapshot } from "@/services/syncPlayManager";
import { DEVICE_LABEL } from "@/utils/hostEnvironment";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import { router, Stack, useFocusEffect, useLocalSearchParams, type NativeStackNavigationOptions } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, LayoutChangeEvent, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;
const HERO_PAD = IS_TV ? 28 : 20;
const QR_MIN = 120;
// A television is scanned from the sofa, so the code takes what the card gives it. A phone or
// tablet is held, and a code larger than this is only bigger, not easier to scan.
const QR_MAX = IS_TV ? Number.MAX_SAFE_INTEGER : IS_PAD ? 360 : 240;

const STATE_LABEL: Record<string, string> = { Idle: "Idle", Waiting: "Waiting", Playing: "Playing", Paused: "Paused" };

/** Who is in the group, by name. The server lists distinct accounts, not devices. */
function watching(participants: string[], state: string): string {
  const who = participants.length ? participants.join(", ") : "Nobody yet";
  return `${who} · ${STATE_LABEL[state] ?? state}`;
}

/**
 * SyncPlay is one centred area, never a browser. The device is in a group or it is not,
 * and the screen shows whichever that is: the group's join code, or the groups it could join.
 *
 * Nothing here offers to create a group while already in one. Jellyfin's NewGroup silently
 * leaves the session's current group first (SyncPlayManager.NewGroup), which destroys the old
 * one and races the listing, so the button only exists in the state where that leave is a
 * no-op. With nothing to join, the group is made on arrival and there is no button at all.
 */
export default function WatchTogetherScreen() {
  const params = useLocalSearchParams<{ serverId?: string; groupId?: string }>();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [snap, setSnap] = useState<SyncPlaySnapshot>({ access: null, groups: [], listing: false, listed: false, busy: null, group: null, error: null });
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [heroBox, setHeroBox] = useState({ width: 0, height: 0 });
  // The button's own style is flattened last, so a focus ring cannot show through it: the
  // whole treatment swaps on focus instead, outline at rest and solid red when focused.
  const [exitFocused, setExitFocused] = useState(false);
  const linkHandledRef = useRef(false);
  const autoCreatedRef = useRef(false);

  useEffect(() => subscribe(setSnap), []);

  // The server's own id, which the join link needs. The stored key is not written on every
  // sign-in path, so a missing one is asked of the server rather than leaving the code blank.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await getStoredServerId();
        if (cancelled) return;
        if (stored) {
          setActiveServerId(stored);
          return;
        }
        const config = await getConfig();
        if (cancelled || !config.server) return;
        const info = await checkServerInfo(config.server);
        if (!cancelled && info?.Id) setActiveServerId(info.Id);
      } catch (error) {
        logger.warn("Could not resolve the server id for the join code", error, { service: "SyncPlay" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshAccess();
      void refreshGroups();
      // Opening this screen while the group is mid-item is the ask to catch up on this
      // device. It no-ops when the player is already on the group's item.
      resumeGroupPlayback();
    }, []),
  );

  // A scanned join link only joins when this device is signed into the link's server, since
  // the link carries no credentials. A mismatch shows a note, never a silent wrong join.
  const linkMismatch = !!params.groupId && !!params.serverId && activeServerId !== null && params.serverId !== activeServerId;
  useEffect(() => {
    if (linkHandledRef.current || !params.groupId || !params.serverId || activeServerId === null) return;
    linkHandledRef.current = true;
    if (params.serverId !== activeServerId) {
      logger.warn("SyncPlay join link is for another server", { service: "SyncPlay" });
      return;
    }
    void switchGroup(params.groupId);
  }, [params.groupId, params.serverId, activeServerId]);

  // Named for the screen, not the account: Jellyfin keys group membership on the session
  // (SyncPlayManager's _sessionToGroupMap), so one person hosting from a television and a
  // phone owns two groups, and two rows called the same thing could not be told apart. The
  // account is already on every row, in the participants line.
  const onCreate = useCallback(async () => {
    await createGroup(DEVICE_LABEL);
  }, []);

  const canCreate = snap.access === "CreateAndJoinGroups";
  const nothingToJoin = snap.listed && snap.groups.length === 0;

  // Hosting is the arrival state only when the server has nothing to join: with someone
  // already watching, defaulting to a group of one would hide them. Once per visit, so
  // Exit Group cannot be undone by the screen that offered it.
  useEffect(() => {
    if (autoCreatedRef.current || !canCreate || !nothingToJoin) return;
    if (snap.group !== null || snap.busy !== null || params.groupId) return;
    autoCreatedRef.current = true;
    void onCreate();
  }, [canCreate, nothingToJoin, snap.group, snap.busy, params.groupId, onCreate]);

  const onJoin = useCallback(async (groupId: string) => {
    setBusyId(groupId);
    await switchGroup(groupId);
    setBusyId(null);
  }, []);

  const onLeave = useCallback(async () => {
    await leaveGroup();
    router.back();
  }, []);

  const onHeroLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setHeroBox((box) => (Math.abs(box.width - width) < 1 && Math.abs(box.height - height) < 1 ? box : { width, height }));
  }, []);

  // Phone and tablet carry the way out as a real bar item, beside the Settings back label.
  const screenOptions = useMemo<NativeStackNavigationOptions>(
    () => ({
      unstable_headerRightItems: () =>
        snap.group
          ? [
              {
                type: "button" as const,
                label: "Exit Group",
                labelStyle: { color: COLORS.DESTRUCTIVE },
                tintColor: COLORS.DESTRUCTIVE,
                onPress: onLeave,
              },
            ]
          : [],
    }),
    [snap.group, onLeave],
  );

  const group = snap.group;
  // The hero is flex on a television, so its height is the card's leftover and does not move
  // with the code inside it. A phone's hero is content-sized, so height cannot be read back
  // without the code chasing its own box: there the width and the cap decide.
  const qrSize = Math.max(QR_MIN, Math.min(heroBox.width - HERO_PAD * 2, IS_TV ? heroBox.height - HERO_PAD * 2 : QR_MAX));
  // The gap between arriving and the group existing. A failed create ends it: the error needs
  // a card that can offer the retry, not a spinner that never stops.
  const creating = canCreate && nothingToJoin && group === null && snap.error === null;
  const waiting = snap.access === null || (!snap.listed && group === null) || creating;

  const body = () => {
    if (linkMismatch) return centred("link-outline", "That group is on a different server. Switch to it, then scan again.");
    if (snap.access === "None") return centred("people-outline", "Your account cannot use SyncPlay. Ask the server owner to enable it for this account.");
    if (waiting) return centred(null, snap.error ?? "Setting up your group");

    if (group !== null) {
      return (
        <View style={[settingsStyles.section, IS_TV && styles.grow]}>
          {/* The code alone, so its size is set by the box rather than competing with copy
              inside it. The group's identity sits in the footer, where the card ends. */}
          <View style={styles.hero} onLayout={onHeroLayout} collapsable={false}>
            {activeServerId && qrSize > QR_MIN ? <JoinQr serverId={activeServerId} groupId={group.groupId} size={qrSize} /> : null}
          </View>
          <SectionFooter>
            <View style={styles.footerBlock} collapsable={false}>
              <Text style={styles.groupName} numberOfLines={1}>
                {group.groupName}
              </Text>
              <Text style={styles.groupWho} numberOfLines={1}>
                {snap.error ?? watching(group.participants, group.state)}
              </Text>
            </View>
          </SectionFooter>
        </View>
      );
    }

    // Someone is hosting. Joining them is the point of the screen, so their groups are the
    // content; hosting a second one stays available but never leads. With no groups this is
    // the retry after a failed create, which is why the row survives an empty list.
    if (snap.groups.length > 0 || canCreate) {
      return (
        <View style={settingsStyles.section}>
          {snap.groups.map((entry, index) => (
            <ListRow
              key={entry.GroupId}
              icon="people-outline"
              title={entry.GroupName}
              subtitle={watching(entry.Participants, entry.State)}
              trailingIcon="chevron-forward"
              onPress={() => void onJoin(entry.GroupId)}
              isLoading={busyId === entry.GroupId}
              isFirst={index === 0}
              hasTVPreferredFocus={index === 0}
            />
          ))}
          {canCreate ? (
            <ListRow
              icon="add-circle-outline"
              title="Start my own group"
              subtitle="Others on this server can join it"
              onPress={() => void onCreate()}
              isLoading={snap.busy === "creating"}
              isFirst={snap.groups.length === 0}
              hasTVPreferredFocus={snap.groups.length === 0}
            />
          ) : null}
          <SectionFooter>
            <Text style={settingsStyles.sectionNote}>{snap.error ?? (snap.groups.length > 0 ? "Join a group to watch in sync" : "Start a group so others can join")}</Text>
          </SectionFooter>
        </View>
      );
    }

    // Join-only account with an idle server: nothing to do but wait for a host.
    return centred("people-outline", snap.error ?? "Nobody is watching right now. When someone starts a group on this server, it appears here.");
  };

  return (
    <View style={settingsStyles.screenContainer}>
      {!IS_TV && <Stack.Screen options={screenOptions} />}
      <AmbientBackground />
      <View style={[styles.page, { paddingTop: IS_TV ? 40 + insets.top : headerHeight + 12, paddingBottom: (IS_TV ? 60 : 24) + insets.bottom }]}>
        <View style={[settingsStyles.contentContainer, styles.column]} collapsable={false}>
          {/* Header line carries the way out, where Diagnostics carries Send. */}
          <View style={styles.titleRow} collapsable={false}>
            <Text style={settingsStyles.sectionHeaderText} numberOfLines={1}>
              SYNCPLAY
            </Text>
            {IS_TV && group ? (
              <FocusableButton
                title="Exit Group"
                variant="destructive"
                onPress={onLeave}
                isLoading={snap.busy === "leaving"}
                style={exitFocused ? styles.exitButtonFocused : styles.exitButton}
                textStyle={exitFocused ? styles.exitTextFocused : styles.exitText}
                onFocus={() => setExitFocused(true)}
                onBlur={() => setExitFocused(false)}
                accessibilityLabel={`Exit ${group.groupName}`}
              />
            ) : null}
          </View>
          {body()}
        </View>
      </View>
    </View>
  );
}

/** The states with nothing to act on: one mark and one line, centred in a card of its own. */
function centred(icon: keyof typeof Ionicons.glyphMap | null, message: string) {
  return (
    <View style={[settingsStyles.section, styles.emptyCard]} collapsable={false}>
      {icon ? <Ionicons name={icon} size={IS_TV ? 72 : 56} color={COLORS.TEXT_QUATERNARY} /> : <ActivityIndicator color={COLORS.ACCENT} size="large" />}
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: "center" },
  column: { flex: 1 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: IS_TV ? 16 : 10, marginHorizontal: 16 },
  // The card takes the page on a television, so the code has a height to fill.
  grow: { flex: 1 },
  hero: {
    flex: IS_TV ? 1 : undefined,
    alignItems: "center",
    justifyContent: "center",
    gap: IS_TV ? 14 : 10,
    paddingHorizontal: HERO_PAD,
    paddingVertical: HERO_PAD,
  },
  // The footer is the card's name plate, so the group reads at a glance from the sofa.
  footerBlock: {
    backgroundColor: COLORS.SURFACE_SUNKEN,
    paddingHorizontal: IS_TV ? 32 : 20,
    paddingVertical: IS_TV ? 22 : 14,
    gap: IS_TV ? 4 : 2,
  },
  groupName: { color: COLORS.TEXT_BRIGHT, fontSize: IS_TV ? 40 : 22, fontWeight: "700" },
  groupWho: { color: COLORS.TEXT_TERTIARY, fontSize: IS_TV ? 20 : 13 },
  // The stateless cards keep a card's presence rather than reading as a stray line of text.
  emptyCard: { minHeight: IS_TV ? 260 : 160, alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: 24, paddingVertical: 24 },
  emptyText: { color: COLORS.TEXT_SECONDARY, fontSize: IS_TV ? 24 : 15, lineHeight: IS_TV ? 32 : 21, textAlign: "center" },
  // Outlined rather than filled: leaving is the rare action, and the ring names it as the
  // destructive one without competing with the code beside it.
  exitButton: { minWidth: 0, minHeight: IS_TV ? 52 : 40, paddingVertical: 8, paddingHorizontal: IS_TV ? 26 : 18, backgroundColor: "transparent", borderColor: COLORS.DESTRUCTIVE },
  exitButtonFocused: {
    minWidth: 0,
    minHeight: IS_TV ? 52 : 40,
    paddingVertical: 8,
    paddingHorizontal: IS_TV ? 26 : 18,
    backgroundColor: COLORS.DESTRUCTIVE,
    borderColor: COLORS.TEXT_BRIGHT,
    transform: [{ scale: 1.06 }],
  },
  exitText: { fontSize: IS_TV ? 22 : 15, color: COLORS.DESTRUCTIVE },
  exitTextFocused: { fontSize: IS_TV ? 22 : 15, color: COLORS.TEXT_BRIGHT, fontWeight: "700" },
});
