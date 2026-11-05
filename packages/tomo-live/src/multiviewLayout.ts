/** Video tiles are 16:9; the layouts are drawn for that picture, then stretched to fill the stage. */
export const MULTIVIEW_ASPECT = 16 / 9;

/** The fixed layouts, by how they place their spots; the first spot of a featured layout is the big one. */
export const MULTIVIEW_LAYOUTS = ["two", "twoFeatured", "onePlusTwo", "onePlusThree", "grid4"] as const;
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
  /** The line between spots; the stage's own edges get none. */
  gap: number;
}

const A = MULTIVIEW_ASPECT;
type Unit = [x: number, y: number, width: number, height?: number];

/** Each layout in units of a satellite's width (height `width / A` unless given), side by side (`wide`), stacked under
 *  the big spot (`tall`), and for the equal grid one column as well. The shape its stretch crops least is used. */
const SHAPES: Record<MultiviewLayoutName, { wide: Unit[]; tall: Unit[]; column?: Unit[] }> = {
  two: {
    wide: [
      [0, 0, 1],
      [1, 0, 1],
    ],
    tall: [
      [0, 0, 1],
      [0, 1 / A, 1],
    ],
  },
  twoFeatured: {
    wide: [
      [0, 0, 7],
      [7, 0, 3, 7 / A],
    ],
    tall: [
      [0, 0, 7],
      [0, 7 / A, 7, 3 / A],
    ],
  },
  onePlusTwo: {
    wide: [
      [0, 0, 2],
      [2, 0, 1],
      [2, 1 / A, 1],
    ],
    tall: [
      [0, 0, 2],
      [0, 2 / A, 1],
      [1, 2 / A, 1],
    ],
  },
  onePlusThree: {
    wide: [
      [0, 0, 3],
      [3, 0, 1],
      [3, 1 / A, 1],
      [3, 2 / A, 1],
    ],
    tall: [
      [0, 0, 3],
      [0, 3 / A, 1],
      [1, 3 / A, 1],
      [2, 3 / A, 1],
    ],
  },
  grid4: {
    wide: [
      [0, 0, 1],
      [1, 0, 1],
      [0, 1 / A, 1],
      [1, 1 / A, 1],
    ],
    tall: [
      [0, 0, 1],
      [1, 0, 1],
      [0, 1 / A, 1],
      [1, 1 / A, 1],
    ],
    column: [
      [0, 0, 1],
      [0, 1 / A, 1],
      [0, 2 / A, 1],
      [0, 3 / A, 1],
    ],
  },
};

/** How many spots a layout holds. */
export function multiviewSpotCount(layout: MultiviewLayoutName): number {
  return SHAPES[layout].wide.length;
}

/** Whether the layout's first spot is larger than the rest. */
export function multiviewFeatured(layout: MultiviewLayoutName): boolean {
  return layout !== "two" && layout !== "grid4";
}

const EDGE = 0.001;

/** The span from `from` to `to` along a stage side of `size`, short half a line at each end that meets another spot. */
function inset(from: number, to: number, size: number, half: number): [number, number] {
  return [from <= EDGE ? 0 : from + half, to >= size - EDGE ? size : to - half];
}

function place(units: Unit[], space: MultiviewSpace): { rects: MultiviewRect[]; crop: number } {
  const height = ([, , w, h]: Unit) => h ?? w / A;
  const boxWidth = Math.max(...units.map(([x, , w]) => x + w));
  const boxHeight = Math.max(...units.map((unit) => unit[1] + height(unit)));
  const sx = space.width / boxWidth;
  const sy = space.height / boxHeight;
  const half = space.gap / 2;
  let crop = 0;
  const rects = units.map((unit) => {
    const [x, y, w] = unit;
    const [left, right] = inset(x * sx, (x + w) * sx, space.width, half);
    const [top, bottom] = inset(y * sy, (y + height(unit)) * sy, space.height, half);
    const width = Math.max(0, right - left);
    const tall = Math.max(0, bottom - top);
    // How far the 16:9 picture is cut to cover the spot, weighted by the spot's size.
    if (width > 0 && tall > 0) crop += width * tall * Math.abs(Math.log(width / tall / A));
    return { x: left, y: top, width, height: tall };
  });
  return { rects, crop };
}

/** One rect per spot, the first spot first, filling the stage edge to edge with a `gap` line between spots, in the
 *  layout's shape that crops the pictures least. Empty for an empty stage. */
export function multiviewSpots(layout: MultiviewLayoutName, space: MultiviewSpace): MultiviewRect[] {
  if (space.width <= 0 || space.height <= 0) return [];
  const { wide, tall, column } = SHAPES[layout];
  const placed = [wide, tall, ...(column ? [column] : [])].map((units) => place(units, space));
  return placed.reduce((best, next) => (next.crop < best.crop ? next : best)).rects;
}

/** Bottom edge of the spots, so what sits under them (the channel strip) can follow straight after. */
export function multiviewSpotsBottom(rects: readonly MultiviewRect[], gap: number): number {
  return rects.reduce((bottom, rect) => Math.max(bottom, rect.y + rect.height + gap / 2), 0);
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
