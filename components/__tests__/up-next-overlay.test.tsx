import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { FocusableButton } from "../FocusableButton";
import { UpNextOverlay } from "../up-next-overlay";

jest.mock("@expo/vector-icons", () => ({
  Ionicons: "Ionicons",
}));

describe("UpNextOverlay", () => {
  const defaultProps = {
    nextVideoName: "Episode 2 - The Return",
    progress: "1 of 10",
    onSkip: jest.fn(),
    visible: true,
    upNextProgress: 1,
    paused: false,
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders when visible", () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<UpNextOverlay {...defaultProps} />);
    });
    const tree = renderer!.toJSON();
    expect(tree).not.toBeNull();
    renderer!.unmount();
  });

  it("returns null when not visible", () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<UpNextOverlay {...defaultProps} visible={false} />);
    });
    const tree = renderer!.toJSON();
    expect(tree).toBeNull();
    renderer!.unmount();
  });

  it("displays the next video name", () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<UpNextOverlay {...defaultProps} />);
    });
    const root = renderer!.root;

    const textNodes = root.findAllByType("Text" as any);
    const names = textNodes.map((t) => {
      try {
        return t.props.children;
      } catch {
        return null;
      }
    });

    expect(names).toContain("Episode 2 - The Return");
    renderer!.unmount();
  });

  it("displays progress text", () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<UpNextOverlay {...defaultProps} />);
    });
    const root = renderer!.root;

    const textNodes = root.findAllByType("Text" as any);
    const texts = textNodes.map((t) => {
      try {
        return t.props.children;
      } catch {
        return null;
      }
    });

    expect(texts).toContain("1 of 10");
    renderer!.unmount();
  });

  it("reflects upNextProgress in progress bar width", () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<UpNextOverlay {...defaultProps} upNextProgress={0.8} />);
    });
    const root = renderer!.root;

    const findProgressFill = () => {
      const views = root.findAllByType("View" as any);
      return views.find((v) => {
        const style = v.props.style;
        if (Array.isArray(style)) {
          return style.some((s: Record<string, unknown>) => typeof s?.width === "string" && (s.width as string).endsWith("%"));
        }
        return false;
      });
    };

    const fill = findProgressFill();
    const widthStyle = fill?.props.style.find((s: Record<string, unknown>) => typeof s?.width === "string");
    expect(widthStyle?.width).toBe("80%");

    act(() => {
      renderer!.update(<UpNextOverlay {...defaultProps} upNextProgress={0.5} />);
    });

    const fill2 = findProgressFill();
    const widthStyle2 = fill2?.props.style.find((s: Record<string, unknown>) => typeof s?.width === "string");
    expect(widthStyle2?.width).toBe("50%");

    renderer!.unmount();
  });

  it("auto-skips when upNextProgress reaches 0", () => {
    const onSkip = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<UpNextOverlay {...defaultProps} onSkip={onSkip} upNextProgress={0.5} />);
    });

    expect(onSkip).not.toHaveBeenCalled();

    act(() => {
      renderer!.update(<UpNextOverlay {...defaultProps} onSkip={onSkip} upNextProgress={0} />);
    });

    expect(onSkip).toHaveBeenCalledTimes(1);
    renderer!.unmount();
  });

  it("does not auto-skip when paused", () => {
    const onSkip = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<UpNextOverlay {...defaultProps} onSkip={onSkip} upNextProgress={0} paused={true} />);
    });

    expect(onSkip).not.toHaveBeenCalled();
    renderer!.unmount();
  });

  it("renders a Play Now CTA with TV preferred focus", () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<UpNextOverlay {...defaultProps} />);
    });
    const button = renderer!.root.findByType(FocusableButton);

    expect(button.props.title).toBe("Play Now");
    expect(button.props.hasTVPreferredFocus).toBe(true);
    renderer!.unmount();
  });

  it("calls onSkip when the Play Now CTA is pressed", () => {
    const onSkip = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<UpNextOverlay {...defaultProps} onSkip={onSkip} />);
    });
    const button = renderer!.root.findByType(FocusableButton);

    act(() => {
      button.props.onPress();
    });

    expect(onSkip).toHaveBeenCalledTimes(1);
    renderer!.unmount();
  });

  it("does not render progress text when empty", () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<UpNextOverlay {...defaultProps} progress="" />);
    });
    const root = renderer!.root;

    const textNodes = root.findAllByType("Text" as any);
    const progressNode = textNodes.find((t) => {
      try {
        return t.props.children === "";
      } catch {
        return false;
      }
    });

    expect(progressNode).toBeUndefined();
    renderer!.unmount();
  });
});
