import { ConnectStepScreen } from "@/components/settings/ConnectStepScreen";
import { ListRow } from "@/components/settings/ListRow";
import { SectionFooter } from "@/components/settings/SectionFooter";
import { settingsStyles } from "@/components/settings/styles";
import { getStoredUserName } from "@/services/jellyfinApi";
import { createGroup, joinGroup, leaveGroup, refreshGroups, subscribe, SyncPlaySnapshot } from "@/services/syncPlayManager";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";

const STATE_LABEL: Record<string, string> = { Idle: "Idle", Waiting: "Waiting", Playing: "Playing", Paused: "Paused" };

function watching(count: number, state: string): string {
  return `${count} watching · ${STATE_LABEL[state] ?? state}`;
}

/**
 * Create, join or leave a SyncPlay group. Playback itself is driven by the server once
 * a group is joined; this screen only manages membership.
 */
export default function WatchTogetherScreen() {
  const [snap, setSnap] = useState<SyncPlaySnapshot>({ access: null, groups: [], listing: false, busy: null, group: null, error: null });
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const listRef = useRef<ScrollView>(null);

  useEffect(() => subscribe(setSnap), []);

  useFocusEffect(
    useCallback(() => {
      void refreshGroups();
    }, []),
  );

  const pinTop = useCallback(() => listRef.current?.scrollTo({ y: 0, animated: false }), []);
  const pinBottom = useCallback(() => listRef.current?.scrollToEnd({ animated: false }), []);

  const onCreate = useCallback(async () => {
    const name = (await getStoredUserName()) ?? "Watch Together";
    await createGroup(`${name}'s Group`);
  }, []);

  const onJoin = useCallback(async (groupId: string) => {
    setJoiningId(groupId);
    await joinGroup(groupId);
    setJoiningId(null);
  }, []);

  const onLeave = useCallback(async () => {
    await leaveGroup();
    router.back();
  }, []);

  if (snap.group) {
    return (
      <ConnectStepScreen header="WATCH TOGETHER">
        <View style={settingsStyles.section}>
          <ListRow icon="people" title={snap.group.groupName} subtitle={watching(snap.group.participants.length, snap.group.state)} isFirst />
          <ListRow icon="exit-outline" tone="destructive" title="Leave Group" onPress={onLeave} isLoading={snap.busy === "leaving"} isLast hasTVPreferredFocus />
        </View>
      </ConnectStepScreen>
    );
  }

  return (
    <ConnectStepScreen header="WATCH TOGETHER">
      <View style={settingsStyles.section}>
        <ListRow icon="add-circle-outline" title="Create Group" subtitle="Others on this server can join" onPress={onCreate} isLoading={snap.busy === "creating"} isFirst isLast hasTVPreferredFocus />
      </View>

      {snap.groups.length > 0 && (
        <View style={settingsStyles.section}>
          <ScrollView ref={listRef} style={settingsStyles.serverListScrollable}>
            {snap.groups.map((group, index) => (
              <ListRow
                key={group.GroupId}
                icon="people-outline"
                title={group.GroupName}
                subtitle={watching(group.Participants.length, group.State)}
                trailingIcon="chevron-forward"
                onPress={() => onJoin(group.GroupId)}
                isLoading={joiningId === group.GroupId}
                onFocus={index === 0 ? pinTop : index === snap.groups.length - 1 ? pinBottom : undefined}
                isFirst={index === 0}
                isLast={index === snap.groups.length - 1}
              />
            ))}
          </ScrollView>
        </View>
      )}

      <SectionFooter>{snap.error ?? (snap.groups.length === 0 && !snap.listing ? "No groups yet. Create one, then have someone join from their Jellyfin app." : "")}</SectionFooter>
    </ConnectStepScreen>
  );
}
