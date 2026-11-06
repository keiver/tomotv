/** Video tiles are 16:9; every spot and strip card is exactly that picture. */
export const MULTIVIEW_ASPECT = 16 / 9;

/**
 * The fixed layouts. Each cuts a 16:9 screen into a grid of 16:9 cells, and a spot is a square block of cells, so every
 * picture is whole and the screen is filled: squashed by 9/16 it is a square cut into squares.
 */
export const MULTIVIEW_LAYOUTS = ["bigThree", "bigTwo", "grid4", "rowThree", "halvesTwo", "halvesThree"] as const;
export type MultiviewLayoutName = (typeof MULTIVIEW_LAYOUTS)[number];

export interface MultiviewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MultiviewSpace {
  width: number;
  height: number;
  /** The line between spots; the screen's own edges get none. */
  gap: number;
}

/** A spot as a block of `size` x `size` cells at column `x`, row `y`; `live` spots may play their channel live. */
export interface MultiviewCell {
  x: number;
  y: number;
  size: number;
  live: boolean;
}

export interface MultiviewCut {
  /** Cells across and down. */
  grid: number;
  /** The live spots first, the first of them the large one in a layout that has one; then the viewer's picture spots. */
  spots: readonly MultiviewCell[];
  /** The row the channel strip scrolls in, or null for none. */
  strip: number | null;
}

const live = (x: number, y: number, size = 1): MultiviewCell => ({ x, y, size, live: true });
const own = (x: number, y: number): MultiviewCell => ({ x, y, size: 1, live: false });

const CUTS: Record<MultiviewLayoutName, MultiviewCut> = {
  bigThree: { grid: 4, spots: [live(0, 0, 3), live(3, 0), live(3, 1), live(3, 2)], strip: 3 },
  bigTwo: { grid: 3, spots: [live(0, 0, 2), live(2, 0), live(2, 1)], strip: 2 },
  grid4: { grid: 2, spots: [live(0, 0), live(1, 0), live(0, 1), live(1, 1)], strip: null },
  rowThree: { grid: 3, spots: [live(0, 0), live(1, 0), live(2, 0), own(0, 1), own(1, 1), own(2, 1)], strip: 2 },
  halvesTwo: { grid: 4, spots: [live(0, 0, 2), live(2, 0, 2), live(0, 2), live(1, 2), own(2, 2), own(3, 2)], strip: 3 },
  halvesThree: { grid: 4, spots: [live(0, 0, 2), live(2, 0, 2), live(0, 2, 2), live(2, 2), own(3, 2), own(2, 3), own(3, 3)], strip: null },
};

/** The same spots in the same order for a screen taller than wide, stacked down it; `group` is the cards across below them. */
const TALL: Record<MultiviewLayoutName, { grid: number; spots: readonly MultiviewCell[]; group: number }> = {
  bigThree: { grid: 3, spots: [live(0, 0, 3), live(0, 3), live(1, 3), live(2, 3)], group: 3 },
  bigTwo: { grid: 2, spots: [live(0, 0, 2), live(0, 2), live(1, 2)], group: 2 },
  grid4: { grid: 2, spots: [live(0, 0), live(1, 0), live(0, 1), live(1, 1)], group: 2 },
  rowThree: { grid: 3, spots: [live(0, 0, 3), live(0, 3, 3), live(0, 6, 3), own(0, 9), own(1, 9), own(2, 9)], group: 3 },
  halvesTwo: { grid: 2, spots: [live(0, 0, 2), live(0, 2, 2), live(0, 4), live(1, 4), own(0, 5), own(1, 5)], group: 2 },
  halvesThree: { grid: 4, spots: [live(0, 0, 4), live(0, 4, 4), live(0, 8, 4), live(0, 12), own(1, 12), own(2, 12), own(3, 12)], group: 2 },
};

export function multiviewCut(layout: MultiviewLayoutName): MultiviewCut {
  return CUTS[layout];
}

/** How many spots a layout holds, live and picture spots both. */
export function multiviewSpotCount(layout: MultiviewLayoutName): number {
  return CUTS[layout].spots.length;
}

/** How many of its spots may play live: they come first in the spots. */
export function multiviewLiveCount(layout: MultiviewLayoutName): number {
  return CUTS[layout].spots.filter((spot) => spot.live).length;
}

/** Whether the layout's first spot is larger than every other. */
export function multiviewFeatured(layout: MultiviewLayoutName): boolean {
  const [first, ...rest] = CUTS[layout].spots;
  return rest.every((spot) => spot.size < first.size);
}

export interface MultiviewPlacement {
  /** One rect per spot, in the cut's order. */
  spots: MultiviewRect[];
  /** Where the channel strip scrolls, or null. */
  strip: MultiviewRect | null;
  /** One cell's width: a strip card's step. */
  cell: number;
}

const EDGE = 0.001;

/** A span from `from` to `to` inside `[start, end]`, short half a line at each end that meets another span. */
function inset(from: number, to: number, start: number, end: number, half: number): [number, number] {
  return [from <= start + EDGE ? from : from + half, to >= end - EDGE ? to : to - half];
}

/**
 * The layout placed in the largest 16:9 box the stage holds, centred across and from the top, with a `gap` line between
 * spots and none at the box's edges. Empty for an empty stage.
 */
export function multiviewSpots(layout: MultiviewLayoutName, space: MultiviewSpace): MultiviewPlacement {
  if (space.width <= 0 || space.height <= 0) return { spots: [], strip: null, cell: 0 };
  const { grid, spots, strip } = CUTS[layout];
  const width = Math.min(space.width, space.height * MULTIVIEW_ASPECT);
  const height = width / MULTIVIEW_ASPECT;
  const left = (space.width - width) / 2;
  const cell = width / grid;
  const row = height / grid;
  const half = space.gap / 2;
  const rect = (x: number, y: number, size: number): MultiviewRect => {
    const [x0, x1] = inset(left + x * cell, left + (x + size) * cell, left, left + width, half);
    const [y0, y1] = inset(y * row, (y + size) * row, 0, height, half);
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  };
  const row0 = strip === null ? null : rect(0, strip, 1);
  return { spots: spots.map((spot) => rect(spot.x, spot.y, spot.size)), strip: row0 && { ...row0, x: left, width }, cell };
}

/**
 * The strip card at `index`, across its strip: the cards on screen at rest sit exactly on the grid's columns, and those
 * scrolled in after them keep a `gap` line on both sides.
 */
export function multiviewStripCard(index: number, grid: number, cell: number, gap: number): { x: number; width: number } {
  const half = gap / 2;
  const x0 = index * cell + (index > 0 ? half : 0);
  const x1 = (index + 1) * cell - (index === grid - 1 ? 0 : half);
  return { x: x0, width: x1 - x0 };
}

/**
 * Where the group's other channels go: a grid of 16:9 cards from (`x`, `y`), `columns` across `width`, scrolling down
 * with the screen. The spots hold the first `skip.columns` cells of its first `skip.rows` rows; the cards fill the rest.
 */
export interface MultiviewGroup {
  x: number;
  y: number;
  width: number;
  columns: number;
  skip: { columns: number; rows: number };
}

export interface MultiviewFit {
  /** One rect per spot, in the cut's order. */
  spots: MultiviewRect[];
  group: MultiviewGroup;
}

/**
 * The layout fit to a screen of any shape, every spot a whole 16:9 picture. Taller than wide: the tall cut across the
 * width, the group in rows below. Wider than the cut: the screen is one grid of group cards, the cut in its top-left
 * block with at least one column of cards beside it, and the cards fill every cell the spots leave, beside them and
 * below. Otherwise: the cut across the width, the group in rows below.
 */
export function multiviewFit(layout: MultiviewLayoutName, space: MultiviewSpace): MultiviewFit {
  const { width: w, height: h } = space;
  const tall = w < h;
  const { grid, spots } = tall ? TALL[layout] : CUTS[layout];
  const rows = Math.max(...spots.map((spot) => spot.y + spot.size));
  const aspect = (grid / rows) * MULTIVIEW_ASPECT;
  const wide = !tall && w / h > aspect;
  // A group card's width: a cell of the cut, or half of one in the 2x2.
  const across = tall ? TALL[layout].group : grid === 2 ? 4 : grid;
  const card = wide ? Math.min(w / (across + 1), (h * aspect) / across) : w / across;
  const width = card * across;
  const beside = wide ? Math.max(1, Math.floor((w - width) / card + EDGE)) : 0;
  const left = wide ? (w - (across + beside) * card) / 2 : 0;
  const height = width / aspect;
  const cell = width / grid;
  const half = space.gap / 2;
  const rect = (x: number, y: number, size: number): MultiviewRect => {
    const [x0, x1] = inset(left + x * cell, left + (x + size) * cell, left, wide ? Infinity : left + width, half);
    const [y0, y1] = inset((y * cell) / MULTIVIEW_ASPECT, ((y + size) * cell) / MULTIVIEW_ASPECT, 0, Infinity, half);
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  };
  const group: MultiviewGroup = wide
    ? { x: left, y: 0, width: (across + beside) * card, columns: across + beside, skip: { columns: across, rows: Math.round(height / (card / MULTIVIEW_ASPECT)) } }
    : { x: 0, y: height, width: w, columns: tall ? TALL[layout].group : across, skip: { columns: 0, rows: 0 } };
  return { spots: spots.map((spot) => rect(spot.x, spot.y, spot.size)), group };
}

/** How many group cards the group's first `rows` rows hold. */
export function multiviewGroupCount(group: MultiviewGroup, rows: number): number {
  const beside = group.columns - group.skip.columns;
  return Math.min(rows, group.skip.rows) * beside + Math.max(0, rows - group.skip.rows) * group.columns;
}

/** How many rows of the group `count` cards take. */
export function multiviewGroupRows(group: MultiviewGroup, count: number): number {
  const beside = (group.columns - group.skip.columns) * group.skip.rows;
  if (count <= beside) return group.skip.rows > 0 && beside > 0 ? Math.ceil(count / (group.columns - group.skip.columns)) : 0;
  return group.skip.rows + Math.ceil((count - beside) / group.columns);
}

/** The group card at `index`, from the group's corner: a line between cards and between the cards and the spots. */
export function multiviewGroupCard(index: number, group: MultiviewGroup, gap: number): MultiviewRect {
  const half = gap / 2;
  const cell = group.width / group.columns;
  const tall = cell / MULTIVIEW_ASPECT;
  const perRow = group.columns - group.skip.columns;
  const besideCount = perRow * group.skip.rows;
  const row = index < besideCount ? Math.floor(index / perRow) : group.skip.rows + Math.floor((index - besideCount) / group.columns);
  const column = index < besideCount ? group.skip.columns + (index % perRow) : (index - besideCount) % group.columns;
  const x0 = column * cell + (column > 0 ? half : 0);
  const x1 = (column + 1) * cell - (column < group.columns - 1 ? half : 0);
  const y0 = row * tall + (row > 0 || group.y > 0 ? half : 0);
  const y1 = (row + 1) * tall - half;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * The tiles on screen kept where they are: those `keep` still allows stay in place, gaps close, and channels from `fresh`
 * not already shown fill up to `count`. The main stays first while it is kept.
 */
export function keepMultiviewOrder(shown: readonly string[], fresh: readonly string[], count: number, keep: (channelId: string) => boolean): string[] {
  const kept = shown.filter(keep).slice(0, count);
  for (const channelId of fresh) {
    if (kept.length >= count) break;
    if (!kept.includes(channelId) && keep(channelId)) kept.push(channelId);
  }
  return kept;
}

/**
 * The main, then up to `count - 1` satellites around it in `list`: half before it, the rest after, wrapping at the ends,
 * in list order. Channels `skip` names are passed over; a side that runs out leaves its share to the other.
 */
export function multiviewChannels(list: readonly string[], mainId: string, count: number, skip: (channelId: string) => boolean = () => false): string[] {
  const at = list.indexOf(mainId);
  if (at < 0 || count < 1) return at < 0 ? [] : [mainId];
  const n = list.length;
  const want = Math.min(count - 1, list.filter((id) => id !== mainId && !skip(id)).length);
  // Nearest first, one way round the list.
  const walk = (direction: 1 | -1, limit: number, taken: ReadonlySet<string>): string[] => {
    const found: string[] = [];
    for (let step = 1; step < n && found.length < limit; step++) {
      const id = list[(((at + direction * step) % n) + n) % n];
      if (id !== mainId && !skip(id) && !taken.has(id)) found.push(id);
    }
    return found;
  };
  const share = walk(-1, Math.floor(want / 2), new Set());
  const after = walk(1, want - share.length, new Set(share));
  // A short list leaves the after side short: the before side takes what is left.
  const before = walk(-1, want - after.length, new Set(after));
  return [mainId, ...before.reverse(), ...after];
}
