/** useChannelFavoriteMenu: the native sheet names the channel, offers the opposite of its state, and toggles on confirm only. */
import { useChannelFavoriteMenu } from "@/hooks/useChannelFavoriteMenu";
import { createGroup, getLiveTvPreferences, toggleFavoriteChannel } from "@/services/liveTvPreferences";
import React, { forwardRef, useImperativeHandle } from "react";
import { Alert } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

type Handle = { open: (channel: { Id: string; Name: string; ChannelNumber?: string }) => void };
const Probe = forwardRef<Handle>((_props, ref) => {
  const open = useChannelFavoriteMenu();
  useImperativeHandle(ref, () => ({ open: (channel) => open(channel as never) }), [open]);
  return null;
});
Probe.displayName = "Probe";

const kqed = { Id: "c1", Name: "KQED", ChannelNumber: "9.1" };
type Button = { text: string; style?: string; onPress?: () => void };

describe("useChannelFavoriteMenu", () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  beforeEach(() => alert.mockClear());

  it("offers Add on a plain channel, toggles on confirm, then offers Remove", () => {
    const ref = React.createRef<Handle>();
    act(() => {
      TestRenderer.create(<Probe ref={ref} />);
    });
    act(() => ref.current?.open(kqed));
    let [title, , buttons] = alert.mock.calls[0] as [string, string | undefined, Button[]];
    expect(title).toBe("KQED");
    expect(buttons.map((button) => button.text)).toEqual(["Favorite", "Add to group…", "Cancel"]);
    expect(buttons[2].style).toBe("cancel");

    act(() => buttons[0].onPress?.());
    expect(getLiveTvPreferences().favorites).toEqual([{ id: "c1", number: "9.1", name: "KQED" }]);

    act(() => ref.current?.open(kqed));
    [title, , buttons] = alert.mock.calls[1] as [string, string | undefined, Button[]];
    expect(buttons[0]).toMatchObject({ text: "Unfavorite", style: "destructive" });
    act(() => buttons[0].onPress?.());
    expect(getLiveTvPreferences().favorites).toEqual([]);
    toggleFavoriteChannel(kqed);
    expect(getLiveTvPreferences().favorites).toHaveLength(1);
  });

  it("lists the groups with the channel's membership ticked, toggles one, and offers a new group holding the channel", () => {
    const ref = React.createRef<Handle>();
    act(() => {
      TestRenderer.create(<Probe ref={ref} />);
    });
    const group = createGroup("Locals");
    act(() => ref.current?.open(kqed));
    const menu = alert.mock.calls[0][2] as Button[];
    act(() => menu[1].onPress?.());
    let sheet = alert.mock.calls[1][2] as Button[];
    expect(sheet.map((button) => button.text)).toEqual(["Locals", "New group", "Cancel"]);
    act(() => sheet[0].onPress?.());
    expect(getLiveTvPreferences().groups.find((entry) => entry.id === group.id)?.channels).toEqual([{ id: "c1", number: "9.1", name: "KQED" }]);

    act(() => ref.current?.open(kqed));
    act(() => (alert.mock.calls[2][2] as Button[])[1].onPress?.());
    sheet = alert.mock.calls[3][2] as Button[];
    expect(sheet[0].text).toBe("✓ Locals");
    act(() => sheet[1].onPress?.());
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/channel-group", params: { channelName: "KQED", channelNumber: "9.1" } });
  });
});
