/** useChannelFavoriteMenu: the native sheet names the channel, offers the opposite of its state, and toggles on confirm only. */
import { useChannelFavoriteMenu } from "@/hooks/useChannelFavoriteMenu";
import { getLiveTvPreferences, toggleFavoriteChannel } from "@/services/liveTvPreferences";
import React, { forwardRef, useImperativeHandle } from "react";
import { Alert } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

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
    expect(buttons.map((button) => button.text)).toEqual(["Favorite", "Cancel"]);
    expect(buttons[1].style).toBe("cancel");

    act(() => buttons[0].onPress?.());
    expect(getLiveTvPreferences().favorites).toEqual([{ number: "9.1", name: "KQED" }]);

    act(() => ref.current?.open(kqed));
    [title, , buttons] = alert.mock.calls[1] as [string, string | undefined, Button[]];
    expect(buttons[0]).toMatchObject({ text: "Unfavorite", style: "destructive" });
    act(() => buttons[0].onPress?.());
    expect(getLiveTvPreferences().favorites).toEqual([]);
    toggleFavoriteChannel(kqed);
    expect(getLiveTvPreferences().favorites).toHaveLength(1);
  });
});
