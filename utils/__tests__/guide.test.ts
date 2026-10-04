import {
  activeRecordTimer,
  adjacentChannelId,
  cellAtEdge,
  cellGeometry,
  cellInSpan,
  channelWindow,
  dayHasListings,
  dayStartMs,
  dayStripFirst,
  durationLabel,
  exitsToCard,
  formatDayBox,
  formatDayHeading,
  GUIDE_DAYS,
  GUIDE_SPAN_MINUTES,
  guideDays,
  guideDayWindow,
  guideMetrics,
  guideRefreshOutcome,
  guideWindowStart,
  isActiveTimer,
  isAiring,
  isRowStart,
  keepRange,
  mergePrograms,
  MINUTE_MS,
  mountSpanFor,
  NO_GUIDE_PREFIX,
  programCategory,
  revealOffset,
  ringWithCenter,
  rowSnap,
  rulerTicks,
  standInChannelId,
  trimPrograms,
} from "../guide";
import { __setLocaleForTests } from "@/services/i18n";

const tv = guideMetrics(true);
const T0 = Date.UTC(2026, 8, 12, 4, 0, 0);
const WINDOW_END = T0 + 360 * MINUTE_MS;

describe("guide geometry", () => {
  it("opens the window on the half hour the current time falls in", () => {
    expect(guideWindowStart(Date.UTC(2026, 8, 12, 4, 17, 30))).toBe(Date.UTC(2026, 8, 12, 4, 0, 0));
    expect(guideWindowStart(Date.UTC(2026, 8, 12, 4, 45, 0))).toBe(Date.UTC(2026, 8, 12, 4, 30, 0));
  });

  it("opens on the local half hour in a 45-minute offset zone", () => {
    // UTC+5:45 (Kathmandu): 14:25 UTC is 20:10 local, so the window opens at 20:00 local, 14:15 UTC.
    const offset = jest.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(-345);
    try {
      expect(guideWindowStart(Date.UTC(2026, 8, 14, 14, 25))).toBe(Date.UTC(2026, 8, 14, 14, 15));
    } finally {
      offset.mockRestore();
    }
  });

  it("places a cell by its start and duration", () => {
    const cell = cellGeometry(T0 + 30 * MINUTE_MS, T0 + 90 * MINUTE_MS, T0, WINDOW_END, tv);
    expect(cell).toEqual({ left: 240, width: 480 });
  });

  it("clips a cell that started before the window", () => {
    const cell = cellGeometry(T0 - 60 * MINUTE_MS, T0 + 30 * MINUTE_MS, T0, WINDOW_END, tv);
    expect(cell).toEqual({ left: 0, width: 240 });
  });

  it("finds a cell in a span by any overlap, its edges included", () => {
    const span = { fromPx: 1000, toPx: 2000 };
    expect(cellInSpan({ left: 500, width: 600 }, span)).toBe(true);
    expect(cellInSpan({ left: 1900, width: 400 }, span)).toBe(true);
    expect(cellInSpan({ left: 0, width: 5000 }, span)).toBe(true);
    expect(cellInSpan({ left: 400, width: 600 }, span)).toBe(true);
    expect(cellInSpan({ left: 0, width: 999 }, span)).toBe(false);
    expect(cellInSpan({ left: 2001, width: 100 }, span)).toBe(false);
  });

  it("mounts a whole viewport past either edge of the view anywhere inside its page", () => {
    const viewport = 1620;
    for (const page of [0, 1, 4]) {
      const span = mountSpanFor(page, viewport);
      for (const scrollX of [page * viewport, (page + 0.5) * viewport, (page + 1) * viewport - 1]) {
        expect(scrollX - span.fromPx).toBeGreaterThanOrEqual(viewport);
        expect(span.toPx - (scrollX + viewport)).toBeGreaterThanOrEqual(viewport);
      }
      expect(span.toPx - span.fromPx).toBe(4 * viewport);
    }
  });

  it("pads the list so its last row lands like any other, on the row grid", () => {
    for (const listHeight of [800, 657, 219, 1000]) {
      const { offset, bottomPad } = rowSnap(listHeight, 219);
      expect(offset % 219).toBe(0);
      for (const rows of [5, 12, 40]) {
        const maxOffset = rows * 219 + bottomPad - listHeight;
        expect(maxOffset).toBe((rows - 1) * 219 - offset);
        expect(maxOffset % 219).toBe(0);
      }
    }
  });

  it("brings a cell's start into view only when it begins left of the visible edge; the focus engine reveals the rest", () => {
    expect(revealOffset({ left: 0, width: 300 }, 1200)).toBe(0);
    expect(revealOffset({ left: 800, width: 300 }, 1200)).toBe(800);
    expect(revealOffset({ left: 1200, width: 300 }, 1200)).toBeUndefined();
    expect(revealOffset({ left: 2600, width: 400 }, 1200)).toBeUndefined();
    expect(revealOffset({ left: 2000, width: 2400 }, 1200)).toBeUndefined();
  });

  it("hands Left to the channel card from a row's first cell in a scrolled grid, and only then", () => {
    expect(exitsToCard("left", true, 900)).toBe(true);
    expect(exitsToCard("swipeLeft", true, 900)).toBe(true);
    expect(exitsToCard("left", true, 0)).toBe(false);
    expect(exitsToCard("left", false, 900)).toBe(false);
    expect(exitsToCard("right", true, 900)).toBe(false);
  });

  it("calls a cell its row's start when no cell in the row starts before it", () => {
    const at = (startMin: number, endMin: number, Id: string) => ({ Id, StartDate: new Date(T0 + startMin * MINUTE_MS).toISOString(), EndDate: new Date(T0 + endMin * MINUTE_MS).toISOString() });
    const cells = [at(30, 60, "b"), at(-30, 30, "a"), at(60, 90, "c")];
    expect(isRowStart(cells, cells[1])).toBe(true);
    expect(isRowStart(cells, cells[0])).toBe(false);
    expect(isRowStart(cells, cells[2])).toBe(false);
    const standIn = at(0, 360, `${NO_GUIDE_PREFIX}ch1`);
    expect(isRowStart([standIn], standIn)).toBe(true);
  });

  it("clips a cell that runs past the window end", () => {
    const cell = cellGeometry(WINDOW_END - 30 * MINUTE_MS, WINDOW_END + 60 * MINUTE_MS, T0, WINDOW_END, tv);
    expect(cell?.width).toBe(240);
  });

  it("drops programs outside the window and zero-length ones", () => {
    expect(cellGeometry(T0 - 120 * MINUTE_MS, T0, T0, WINDOW_END, tv)).toBeNull();
    expect(cellGeometry(WINDOW_END, WINDOW_END + 60 * MINUTE_MS, T0, WINDOW_END, tv)).toBeNull();
    expect(cellGeometry(T0, T0, T0, WINDOW_END, tv)).toBeNull();
  });

  it("keeps a one-minute program wide enough to focus", () => {
    const cell = cellGeometry(T0, T0 + MINUTE_MS, T0, WINDOW_END, tv);
    expect(cell?.width).toBe(tv.pxPerMinute);
  });

  it("lays a minor mark every five minutes, labels the half hours and marks the hours", () => {
    const ticks = rulerTicks(T0, T0 + 90 * MINUTE_MS, tv);
    expect(ticks).toHaveLength(18);
    expect(ticks[1]).toMatchObject({ left: 40, isMinor: true, isHour: false });
    const majors = ticks.filter((tick) => !tick.isMinor);
    expect(majors.map((tick) => tick.left)).toEqual([0, 240, 480]);
    expect(majors.map((tick) => tick.isHour)).toEqual([true, false, true]);
  });

  it("lays only the marks inside a span, at the places the whole window gives them", () => {
    const all = rulerTicks(T0, WINDOW_END, tv);
    expect(rulerTicks(T0, WINDOW_END, tv, { fromPx: 400, toPx: 800 })).toEqual(all.filter((tick) => tick.left >= 400 && tick.left <= 800));
    expect(rulerTicks(T0, WINDOW_END, tv, { fromPx: -1600, toPx: 120 })).toEqual(all.slice(0, 4));
    expect(rulerTicks(T0, WINDOW_END, tv, { fromPx: 2800, toPx: 9000 }).at(-1)).toEqual(all.at(-1));
  });

  it("keeps the needed stretch widened to whole spans, two more each side, never before the origin", () => {
    const span = GUIDE_SPAN_MINUTES * MINUTE_MS;
    expect(keepRange(T0, T0 + 100 * MINUTE_MS, T0 + 500 * MINUTE_MS)).toEqual({ from: T0, to: T0 + 4 * span });
    expect(keepRange(T0, T0 + 1500 * MINUTE_MS, T0 + 1900 * MINUTE_MS)).toEqual({ from: T0 + 2 * span, to: T0 + 8 * span });
    expect(keepRange(T0, T0 - 400 * MINUTE_MS, T0 + 360 * MINUTE_MS)).toEqual({ from: T0, to: T0 + 3 * span });
  });

  it("names the channel a stand-in cell stands for", () => {
    expect(standInChannelId(`${NO_GUIDE_PREFIX}abc123`)).toBe("abc123");
    expect(standInChannelId("abc123")).toBeNull();
    expect(standInChannelId(undefined)).toBeNull();
  });

  it("tells a finished refresh's outcome: failed, no listings, or updated", () => {
    expect(guideRefreshOutcome(true, true)).toEqual({ title: "liveTv.guideUnavailable", kind: "error" });
    expect(guideRefreshOutcome(false, false)).toEqual({ title: "liveTv.noGuide", kind: "info" });
    expect(guideRefreshOutcome(false, true)).toEqual({ title: "liveTv.guideUpdated", kind: "success" });
  });

  it("names the airing program by its dates", () => {
    const program = { StartDate: new Date(T0).toISOString(), EndDate: new Date(T0 + 60 * MINUTE_MS).toISOString() };
    expect(isAiring(program, T0 + MINUTE_MS)).toBe(true);
    expect(isAiring(program, T0 + 60 * MINUTE_MS)).toBe(false);
    expect(isAiring({}, T0)).toBe(false);
  });

  it("counts a timer as active until it is cancelled or completed", () => {
    expect(isActiveTimer({ Status: "New" })).toBe(true);
    expect(isActiveTimer({ Status: "InProgress" })).toBe(true);
    expect(isActiveTimer({ Status: "Completed" })).toBe(false);
    expect(isActiveTimer({ Status: "Cancelled" })).toBe(false);
  });

  describe("activeRecordTimer", () => {
    const span = (from: number, to: number) => ({ StartDate: new Date(T0 + from * MINUTE_MS).toISOString(), EndDate: new Date(T0 + to * MINUTE_MS).toISOString() });
    const timer = (Id: string, from: number, to: number, ProgramId?: string) => ({ Id, Name: Id, ChannelId: "c1", ProgramId, Status: "InProgress" as const, ...span(from, to) });
    const now = T0 + 30 * MINUTE_MS;
    const recordingA = timer("a", 0, 60, "A");
    const manual = timer("m", 0, 120);

    it("names a program's own timer first", () => {
      expect(activeRecordTimer([manual, recordingA], { programId: "A", channelId: "c1", program: span(0, 60) }, now)?.Id).toBe("a");
    });

    it("never hands a program another program's timer on its channel", () => {
      expect(activeRecordTimer([recordingA], { programId: "B", channelId: "c1", program: span(60, 120) }, now)).toBeNull();
      expect(activeRecordTimer([recordingA], { programId: "B", channelId: "c1" }, now)).toBeNull();
    });

    it("falls back to a manual timer over the program's span, or over the clock without one", () => {
      expect(activeRecordTimer([manual], { programId: "B", channelId: "c1", program: span(60, 120) }, now)?.Id).toBe("m");
      expect(activeRecordTimer([manual], { programId: "C", channelId: "c1", program: span(150, 180) }, now)).toBeNull();
      expect(activeRecordTimer([manual], { programId: "A", channelId: "c1" }, now)?.Id).toBe("m");
      expect(activeRecordTimer([manual], { programId: "A", channelId: "c2" }, now)).toBeNull();
    });

    it("gives a channel whatever timer records it now", () => {
      expect(activeRecordTimer([recordingA], { channelId: "c1" }, now)?.Id).toBe("a");
      expect(activeRecordTimer([recordingA], { channelId: "c1" }, T0 + 90 * MINUTE_MS)).toBeNull();
    });

    it("matches an external programme by its scheduled span instead of the current clock", () => {
      const future = timer("future", 150, 180);
      const target = { channelId: "c1", program: span(150, 180) };
      expect(activeRecordTimer([manual, recordingA], target, now)).toBeNull();
      expect(activeRecordTimer([manual, future], target, now)?.Id).toBe("future");
      expect(activeRecordTimer([{ ...future, Status: "Cancelled" }], target, now)).toBeNull();
    });
  });

  it("lands a vertical move on the cell under the edge, else the first after it", () => {
    const at = (from: number, to: number) => ({ Id: `${from}`, StartDate: new Date(T0 + from * MINUTE_MS).toISOString(), EndDate: new Date(T0 + to * MINUTE_MS).toISOString() });
    const row = [at(0, 30), at(30, 60), at(90, 120)];
    expect(cellAtEdge(row, T0)?.Id).toBe("0");
    expect(cellAtEdge(row, T0 + 45 * MINUTE_MS)?.Id).toBe("30");
    expect(cellAtEdge(row, T0 + 70 * MINUTE_MS)?.Id).toBe("90");
    expect(cellAtEdge(row, T0 + 200 * MINUTE_MS)?.Id).toBe("90");
    expect(cellAtEdge([], T0)).toBeUndefined();
  });

  it("ranks one category per program, sports first", () => {
    expect(programCategory({ IsSports: true, IsNews: true })).toBe("sports");
    expect(programCategory({ IsKids: true })).toBe("kids");
    expect(programCategory({ IsMovie: true })).toBe("movie");
    expect(programCategory({})).toBeNull();
  });

  it("flips to the adjacent channel, wrapping at the ends", () => {
    const list = [{ Id: "a" }, { Id: "b" }, { Id: "c" }];
    expect(adjacentChannelId(list, "a", 1)).toBe("b");
    expect(adjacentChannelId(list, "c", 1)).toBe("a");
    expect(adjacentChannelId(list, "a", -1)).toBe("c");
    expect(adjacentChannelId(list, "b", -1)).toBe("a");
    expect(adjacentChannelId(list, "missing", 1)).toBeNull();
    expect(adjacentChannelId([{ Id: "only" }], "only", 1)).toBeNull();
    expect(adjacentChannelId([], "x", 1)).toBeNull();
  });

  it("appends a playing channel the shown list does not hold, so a flip from it lands in the list", () => {
    const list = [{ Id: "a" }, { Id: "b" }];
    expect(ringWithCenter(list, { Id: "b" })).toEqual([{ Id: "a" }, { Id: "b" }]);
    expect(ringWithCenter(list, { Id: "z" })).toEqual([{ Id: "a" }, { Id: "b" }, { Id: "z" }]);
    expect(ringWithCenter([], { Id: "z" })).toEqual([{ Id: "z" }]);
    expect(adjacentChannelId(ringWithCenter(list, { Id: "z" }), "z", 1)).toBe("a");
  });

  it("windows the lineup around the playing channel: the previous one, then it and the ones after", () => {
    const list = ["a", "b", "c", "d", "e"].map((Id) => ({ Id }));
    expect(channelWindow(list, "c", 1)).toEqual(["b", "c", "d"]);
    expect(channelWindow(list, "a", 1)).toEqual(["e", "a", "b"]);
    expect(channelWindow(list, "e", 1)).toEqual(["d", "e", "a"]);
    // A lineup shorter than the window wraps no further than itself.
    expect(channelWindow(list, "b", 30)).toEqual(["a", "b", "c", "d", "e"]);
    // Before the lineup arrives, or for a channel it lacks, the window is the playing channel alone.
    expect(channelWindow([], "x", 30)).toEqual(["x"]);
    expect(channelWindow(list, "missing", 30)).toEqual(["missing"]);
  });
});

describe("mergePrograms", () => {
  const window = (from: number, to: number) => ({ from: T0 + from * MINUTE_MS, to: T0 + to * MINUTE_MS });
  const at = (id: string, startMin: number, endMin: number, name = id) => ({
    Id: id,
    Name: name,
    ChannelId: "c1",
    StartDate: new Date(T0 + startMin * MINUTE_MS).toISOString(),
    EndDate: new Date(T0 + endMin * MINUTE_MS).toISOString(),
  });

  it("adds new programmes in start order and keeps one copy of an id", () => {
    const merged = mergePrograms([at("b", 30, 60)], [at("a", 0, 30), at("b", 30, 60), at("a", 0, 30)], window(0, 60));
    expect(merged.map((p) => p.Id)).toEqual(["a", "b"]);
  });

  it("takes the fresh copy of a programme it already holds", () => {
    const merged = mergePrograms([at("s1", 0, 30, "Old title")], [at("s1", 0, 45, "New title")], window(0, 60));
    expect(merged).toEqual([at("s1", 0, 45, "New title")]);
  });

  it("drops removed server and guide-file programmes across the requested window", () => {
    const before = [at("epg:c1:0", 0, 30), at("epg:c1:30", 30, 60), at("epg:c1:60", 60, 90), at("server", 30, 60)];
    // The re-downloaded file starts the second show at :40 and no longer lists the third.
    const merged = mergePrograms(before, [at("epg:c1:0", 0, 40), at("epg:c1:40", 40, 50)], window(0, 90));
    expect(merged.map((p) => p.Id)).toEqual(["epg:c1:0", "epg:c1:40"]);
  });

  it("keeps guide-file programmes outside a later window's span", () => {
    const merged = mergePrograms([at("epg:c1:0", 0, 360)], [at("epg:c1:360", 360, 420)], window(360, 720));
    expect(merged.map((p) => p.Id)).toEqual(["epg:c1:0", "epg:c1:360"]);
  });

  it("clears an empty window, including overlapping shows, while preserving adjacent windows", () => {
    const before = [at("earlier", -30, 0), at("overlap", -10, 10), at("epg:c1:0", 0, 30), at("server", 30, 60), at("later", 60, 90)];
    expect(mergePrograms(before, [], window(0, 60))).toEqual([before[0], before[4]]);
    expect(mergePrograms([{ ...at("unknown-end", 0, 30), EndDate: undefined }], [], window(0, 60))).toEqual([]);
  });
});

describe("trimPrograms", () => {
  const at = (id: string, startMin: number, endMin: number) => ({
    Id: id,
    Name: id,
    ChannelId: "c1",
    StartDate: new Date(T0 + startMin * MINUTE_MS).toISOString(),
    EndDate: new Date(T0 + endMin * MINUTE_MS).toISOString(),
  });

  it("drops the programmes wholly outside the range and keeps the ones crossing its edges", () => {
    const list = [at("before", 0, 60), at("into", 30, 90), at("inside", 90, 120), at("out-of", 150, 240), at("after", 180, 240)];
    expect(trimPrograms(list, T0 + 60 * MINUTE_MS, T0 + 180 * MINUTE_MS).map((p) => p.Id)).toEqual(["into", "inside", "out-of"]);
  });

  it("hands back the same list when nothing leaves it", () => {
    const list = [at("a", 0, 30), at("b", 30, 60)];
    expect(trimPrograms(list, T0, T0 + 60 * MINUTE_MS)).toBe(list);
  });

  it("places a programme with no end by its start", () => {
    const open = { ...at("open", 30, 60), EndDate: undefined };
    const later = at("later", 90, 120);
    expect(trimPrograms([open, later], T0, T0 + 60 * MINUTE_MS)).toEqual([open]);
    expect(trimPrograms([open, later], T0 + 60 * MINUTE_MS, T0 + 120 * MINUTE_MS)).toEqual([later]);
  });

  it("never empties a channel that has listings: its nearest programme stays, so the row never reads as one without", () => {
    const list = [at("a", 0, 30), at("b", 30, 60)];
    expect(trimPrograms(list, T0 + 600 * MINUTE_MS, T0 + 900 * MINUTE_MS).map((p) => p.Id)).toEqual(["b"]);
    expect(trimPrograms(list, T0 - 900 * MINUTE_MS, T0 - 600 * MINUTE_MS).map((p) => p.Id)).toEqual(["a"]);
    const kept = [at("b", 30, 60)];
    expect(trimPrograms(kept, T0 + 600 * MINUTE_MS, T0 + 900 * MINUTE_MS)).toBe(kept);
    expect(trimPrograms([], T0, T0 + 60 * MINUTE_MS)).toEqual([]);
  });
});

describe("durationLabel", () => {
  afterEach(() => __setLocaleForTests("en"));

  it("prints minutes, hours, or both", () => {
    expect(durationLabel(45 * MINUTE_MS)).toBe("45m");
    expect(durationLabel(120 * MINUTE_MS)).toBe("2h");
    expect(durationLabel(72 * MINUTE_MS)).toBe("1h 12m");
  });

  it("prints the active language's units", () => {
    __setLocaleForTests("de");
    expect(durationLabel(30 * MINUTE_MS)).toBe("30 Min.");
    expect(durationLabel(180 * MINUTE_MS)).toBe("3 Std.");
    expect(durationLabel(90 * MINUTE_MS)).toBe("1 Std. 30 Min.");
    __setLocaleForTests("fr");
    expect(durationLabel(90 * MINUTE_MS)).toBe("1 h 30 min");
  });
});

describe("the day strip", () => {
  // Local times: the strip works in the viewer's days, and a DST change on the second day only moves a midnight.
  const midnight = (y: number, m: number, d: number) => new Date(y, m, d).getTime();
  const noon = new Date(2026, 9, 24, 12, 0).getTime();
  const span = GUIDE_SPAN_MINUTES * MINUTE_MS;

  it("finds the local midnight of any moment", () => {
    expect(dayStartMs(noon)).toBe(midnight(2026, 9, 24));
    expect(dayStartMs(new Date(2026, 9, 24, 23, 59).getTime())).toBe(midnight(2026, 9, 24));
  });

  it("offers today and the thirteen days after it by their midnights, across a month end", () => {
    const days = guideDays(noon);
    expect(days).toHaveLength(GUIDE_DAYS);
    expect(days[0]).toBe(midnight(2026, 9, 24));
    expect(days[7]).toBe(midnight(2026, 9, 31));
    expect(days[8]).toBe(midnight(2026, 10, 1));
    expect(guideDays(noon, 3)).toEqual([midnight(2026, 9, 24), midnight(2026, 9, 25), midnight(2026, 9, 26)]);
  });

  it("opens today on the current half hour and ends at midnight, or one span later when the evening is short", () => {
    const afternoon = guideDayWindow(midnight(2026, 9, 24), new Date(2026, 9, 24, 14, 20).getTime());
    expect(afternoon).toEqual({ startMs: new Date(2026, 9, 24, 14, 0).getTime(), horizonMs: midnight(2026, 9, 25) });
    const late = guideDayWindow(midnight(2026, 9, 24), new Date(2026, 9, 24, 23, 40).getTime());
    expect(late).toEqual({ startMs: new Date(2026, 9, 24, 23, 30).getTime(), horizonMs: new Date(2026, 9, 24, 23, 30).getTime() + span });
  });

  it("opens another day at its midnight and ends at the next", () => {
    expect(guideDayWindow(midnight(2026, 9, 26), noon)).toEqual({ startMs: midnight(2026, 9, 26), horizonMs: midnight(2026, 9, 27) });
  });

  it("tells a day's listings from the server guide's end, a loaded day, or neither yet", () => {
    const end = new Date(2026, 9, 30, 22, 0).getTime();
    expect(dayHasListings(midnight(2026, 9, 24), end, new Set())).toBe(true);
    expect(dayHasListings(midnight(2026, 9, 30), end, new Set())).toBe(true);
    expect(dayHasListings(midnight(2026, 9, 31), end, new Set())).toBe(false);
    expect(dayHasListings(midnight(2026, 9, 31), end, new Set([midnight(2026, 9, 31)]))).toBe(true);
    expect(dayHasListings(midnight(2026, 9, 24), null, new Set())).toBeNull();
    expect(dayHasListings(midnight(2026, 9, 24), null, new Set([midnight(2026, 9, 24)]))).toBe(true);
  });

  it("heads a day by its name and short date, and numbers its box by the day of the month, the month on the first", () => {
    const labels = { today: "Today", tomorrow: "Tomorrow" };
    const short = (ms: number) => new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
    expect(formatDayHeading(midnight(2026, 9, 24), noon, labels)).toBe(`Today · ${short(midnight(2026, 9, 24))}`);
    expect(formatDayHeading(midnight(2026, 9, 25), noon, labels)).toBe(`Tomorrow · ${short(midnight(2026, 9, 25))}`);
    expect(formatDayHeading(midnight(2026, 9, 27), noon, labels)).toBe(`${new Date(2026, 9, 27).toLocaleDateString([], { weekday: "long" })} · ${short(midnight(2026, 9, 27))}`);
    expect(formatDayBox(midnight(2026, 9, 31))).toBe("31");
    expect(formatDayBox(midnight(2026, 10, 1))).toBe(new Date(2026, 10, 1).toLocaleDateString([], { month: "short" }));
  });

  it("keeps the strip still for a day in view and lands one past either edge on that edge", () => {
    expect(dayStripFirst(5, 3, 4)).toBe(3);
    expect(dayStripFirst(3, 3, 4)).toBe(3);
    expect(dayStripFirst(6, 3, 4)).toBe(3);
    expect(dayStripFirst(7, 3, 4)).toBe(4);
    expect(dayStripFirst(2, 3, 4)).toBe(2);
    expect(dayStripFirst(0, 9, 4)).toBe(0);
    expect(dayStripFirst(13, 0, 4)).toBe(10);
  });
});
