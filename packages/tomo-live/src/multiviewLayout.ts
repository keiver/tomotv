/** Video tiles are 16:9; every rect here is sized for that picture. */
export const MULTIVIEW_ASPECT = 16 / 9;
/** No layout holds more tiles than this, whatever the window. */
export const MULTIVIEW_MAX_TILES = 16;

export interface MultiviewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MultiviewSpace {
  width: number;
  height: number;
  /** The narrowest a satellite may be. */
  minTileWidth: number;
  /** Space between tiles. */
  gap: number;
}

interface Candidate {
  main: number;
  satellite: number;
  /** Lower wins a tie: side, then bottom, then L, each by its count. */
  rank: number;
  place: () => MultiviewRect[];
}

function centered(rects: MultiviewRect[], width: number, height: number, space: MultiviewSpace): MultiviewRect[] {
  const dx = (space.width - width) / 2;
  const dy = (space.height - height) / 2;
  return rects.map((r) => ({ x: r.x + dx, y: r.y + dy, width: r.width, height: r.height }));
}

/** The main, then `rows` satellites per column beside it, as many columns as the satellites need. */
function side(k: number, rows: number, space: MultiviewSpace): Candidate | null {
  const a = MULTIVIEW_ASPECT;
  const { gap } = space;
  const columns = Math.ceil(k / rows);
  const byWidth = (space.width - columns * gap + (columns * a * (rows - 1) * gap) / rows) / (1 + columns / rows);
  const main = Math.min(byWidth, space.height * a);
  const satellite = (main - a * (rows - 1) * gap) / rows;
  return {
    main,
    satellite,
    rank: rows,
    place: () => {
      const rects: MultiviewRect[] = [{ x: 0, y: 0, width: main, height: main / a }];
      for (let i = 0; i < k; i++) {
        const column = Math.floor(i / rows);
        const row = i % rows;
        rects.push({ x: main + gap + column * (satellite + gap), y: row * (satellite / a + gap), width: satellite, height: satellite / a });
      }
      return centered(rects, main + columns * (gap + satellite), main / a, space);
    },
  };
}

/** The main, then `columns` satellites per row under it, as many rows as the satellites need. */
function bottom(k: number, columns: number, space: MultiviewSpace): Candidate | null {
  const a = MULTIVIEW_ASPECT;
  const { gap } = space;
  const rows = Math.ceil(k / columns);
  const byHeight = (a * (space.height - rows * gap + (rows * (columns - 1) * gap) / (columns * a))) / (1 + rows / columns);
  const main = Math.min(byHeight, space.width);
  const satellite = (main - (columns - 1) * gap) / columns;
  return {
    main,
    satellite,
    rank: 100 + columns,
    place: () => {
      const rects: MultiviewRect[] = [{ x: 0, y: 0, width: main, height: main / a }];
      for (let i = 0; i < k; i++) {
        const row = Math.floor(i / columns);
        const column = i % columns;
        rects.push({ x: column * (satellite + gap), y: main / a + gap + row * (satellite / a + gap), width: satellite, height: satellite / a });
      }
      return centered(rects, main, main / a + rows * (gap + satellite / a), space);
    },
  };
}

/** A g x g grid whose top-left (g-1) x (g-1) cells are the main; satellites run down the right edge, then along the bottom from the corner. */
function lShape(k: number, g: number, space: MultiviewSpace): Candidate | null {
  if (2 * g - 1 < k) return null;
  const a = MULTIVIEW_ASPECT;
  const { gap } = space;
  const cell = Math.min((space.width - (g - 1) * gap) / g, ((space.height - (g - 1) * gap) * a) / g);
  const main = (g - 1) * cell + (g - 2) * gap;
  return {
    main,
    satellite: cell,
    rank: 200 + g,
    place: () => {
      const step = cell / a + gap;
      const rects: MultiviewRect[] = [{ x: 0, y: 0, width: main, height: ((g - 1) * cell) / a + (g - 2) * gap }];
      const slots: MultiviewRect[] = [];
      for (let row = 0; row < g - 1; row++) slots.push({ x: g - 1, y: row, width: cell, height: cell / a });
      for (let column = g - 1; column >= 0; column--) slots.push({ x: column, y: g - 1, width: cell, height: cell / a });
      for (const slot of slots.slice(0, k)) rects.push({ x: slot.x * (cell + gap), y: slot.y * step, width: cell, height: cell / a });
      return centered(rects, g * cell + (g - 1) * gap, g * (cell / a) + (g - 1) * gap, space);
    },
  };
}

function fits(candidate: Candidate | null, space: MultiviewSpace): candidate is Candidate {
  return !!candidate && candidate.main > 0 && candidate.satellite >= space.minTileWidth && candidate.satellite <= candidate.main / 2;
}

/**
 * One rect per tile, the main first: one tile fills the window; more place the main as large as a layout allows with
 * every satellite at least `minTileWidth` and at most half the main's width. Null when `count` tiles cannot fit.
 */
export function multiviewLayout(count: number, space: MultiviewSpace): MultiviewRect[] | null {
  if (count < 1 || count > MULTIVIEW_MAX_TILES || space.width <= 0 || space.height <= 0) return null;
  if (count === 1) {
    const width = Math.min(space.width, space.height * MULTIVIEW_ASPECT);
    return centered([{ x: 0, y: 0, width, height: width / MULTIVIEW_ASPECT }], width, width / MULTIVIEW_ASPECT, space);
  }
  const k = count - 1;
  const candidates: Candidate[] = [];
  // A column or row holds up to 3 slots for fewer satellites, so one or two satellites never stretch to half the main.
  for (let n = 1; n <= Math.max(k, 3); n++) {
    const s = side(k, n, space);
    if (fits(s, space)) candidates.push(s);
    const b = bottom(k, n, space);
    if (fits(b, space)) candidates.push(b);
  }
  const l = lShape(k, Math.max(3, Math.ceil((k + 1) / 2)), space);
  if (fits(l, space)) candidates.push(l);
  if (candidates.length === 0) return null;
  candidates.sort((x, y) => (Math.abs(y.main - x.main) > 0.5 ? y.main - x.main : Math.abs(y.satellite - x.satellite) > 0.5 ? y.satellite - x.satellite : x.rank - y.rank));
  return candidates[0].place();
}

/** The most tiles this space lays out, every smaller count fitting too; at least 1. */
export function multiviewCapacity(space: MultiviewSpace): number {
  let most = 1;
  while (most < MULTIVIEW_MAX_TILES && multiviewLayout(most + 1, space)) most += 1;
  return most;
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
