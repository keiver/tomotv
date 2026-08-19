/**
 * Justified row packing for mixed-shape card grids (folder browsing). ONE height per row,
 * never uneven: a row renders at the tallest shape present in it — wide cards in a poster
 * row grow to match — and the whole row is then scaled uniformly so it EXACTLY fills the
 * available width. No trailing gap, no distortion (aspect ratios are preserved; only the
 * scale changes). The final row never justifies to fill — it matches the previous row's
 * scale, so the tail renders at the same card size as the rows above it. Pure math at pack
 * time — no measurement, no second layout pass — so the focus rules built on it are testable.
 */

export interface CardMetrics {
  /** Slot aspect ratio (w/h) of the item's snapped shape (see artworkSlotRatio). */
  ratio: number;
  /** Nominal card height for the item's shape (see slotRowHeights). */
  height: number;
}

export interface PackedCard<T> {
  item: T;
  /** Card width in px (outer, padding included) at the row's justified scale. */
  width: number;
  /** The row's unified, justified card height (same for every card in the row). */
  cardHeight: number;
  /** Left edge within the row, in px from the content's left edge. */
  x: number;
}

export interface PackedRow<T> {
  cards: PackedCard<T>[];
  /** Total occupied width in px (right edge of the last card). */
  width: number;
}

// How far a justified row may scale from nominal. The clamp guards degenerate rows (one
// near-viewport-wide card, or a break that would demand a huge stretch); a clamped row
// underfills or overflows fractionally instead of distorting the sizes.
const MIN_SCALE = 0.8;
const MAX_SCALE = 1.35;

/**
 * @param availableWidth content width the rows fill (window minus edge padding)
 * @param metricsOf nominal {ratio, height} for an item's card
 * @param cardPadding the card component's outer padding (see slotCardPadding)
 */
export function packArtworkRows<T>(items: readonly T[], availableWidth: number, metricsOf: (item: T) => CardMetrics, cardPadding: number): PackedRow<T>[] {
  // useWindowDimensions can transiently report 0 during layout; a non-positive width would
  // turn every scale into NaN/Infinity and poison the whole list's styles.
  const width = Number.isFinite(availableWidth) && availableWidth > 0 ? availableWidth : 1;

  interface Group {
    items: T[];
    ratios: number[];
    sumRatio: number;
    /** Tallest nominal inner (padding-less) height in the group — the row's unified height. */
    maxInner: number;
  }

  // The uniform scale at which a group, rendered at its unified height, exactly fills the width.
  const scaleFor = (group: { sumRatio: number; maxInner: number }, count: number) => (width - count * 2 * cardPadding) / (group.maxInner * group.sumRatio);

  // Phase 1: split items into row groups. Widths are always evaluated at the group's
  // CURRENT unified height (adding a poster to a wide row grows the wide cards too), and
  // the break lands where the justified scale costs least (one-card lookahead). Shrinking
  // costs MORE than stretching by the same log-distance: squeezing one extra card in reads
  // tight (4 cramped posters on a phone), while fewer, slightly larger cards read composed.
  const SHRINK_PENALTY = 1.4;
  const scaleCost = (scale: number) => Math.abs(Math.log(scale)) * (scale < 1 ? SHRINK_PENALTY : 1);
  const groups: Group[] = [];
  let current: Group = { items: [], ratios: [], sumRatio: 0, maxInner: 0 };

  const close = () => {
    if (current.items.length > 0) {
      groups.push(current);
      current = { items: [], ratios: [], sumRatio: 0, maxInner: 0 };
    }
  };

  for (const item of items) {
    const metrics = metricsOf(item);
    // Metrics are caller data; a single NaN or non-positive value here would corrupt every
    // width in the row. Garbage snaps to the square card at a visible size.
    const ratio = Number.isFinite(metrics.ratio) && metrics.ratio > 0 ? metrics.ratio : 1;
    const rawInner = metrics.height - 2 * cardPadding;
    const inner = Number.isFinite(rawInner) && rawInner > 0 ? rawInner : 1;
    const withItem = {
      sumRatio: current.sumRatio + ratio,
      maxInner: Math.max(current.maxInner, inner),
    };
    const count = current.items.length;
    const naturalWithItem = withItem.maxInner * withItem.sumRatio + (count + 1) * 2 * cardPadding;
    if (count > 0 && naturalWithItem > width) {
      const withScale = scaleFor(withItem, count + 1);
      const withoutScale = scaleFor(current, count);
      if (scaleCost(withScale) < scaleCost(withoutScale)) {
        current.items.push(item);
        current.ratios.push(ratio);
        current.sumRatio = withItem.sumRatio;
        current.maxInner = withItem.maxInner;
        close();
        continue;
      }
      close();
    }
    current.items.push(item);
    current.ratios.push(ratio);
    current.sumRatio += ratio;
    current.maxInner = Math.max(current.maxInner, inner);
  }
  close();

  // Phase 2: materialize each group at its unified, justified height. The last row never
  // justifies to fill — a lone straggler stretched across the viewport would be a
  // billboard — it adopts the PREVIOUS row's scale instead, so the tail renders at the
  // same card size as the row above it (capped by its own exact-fill scale so it can
  // never overflow).
  let previousScale = 1;
  return groups.map((group, groupIndex) => {
    const isLast = groupIndex === groups.length - 1;
    // A width smaller than the padding alone drives the exact-fill scale negative; floor it
    // so a degenerate window still yields positive sizes (the row overflows, never inverts).
    const exact = Math.max(scaleFor(group, group.items.length), MIN_SCALE / 8);
    const scale = isLast ? Math.min(previousScale, exact) : Math.min(Math.max(exact, MIN_SCALE), MAX_SCALE);
    previousScale = scale;

    const rowInner = group.maxInner * scale;
    const cardHeight = rowInner + 2 * cardPadding;
    const cards: PackedCard<T>[] = [];
    let x = 0;
    group.items.forEach((item, i) => {
      const width = rowInner * group.ratios[i] + 2 * cardPadding;
      cards.push({ item, width, cardHeight, x });
      x += width;
    });
    return { cards, width: x };
  });
}

/**
 * Whether a card in the SECOND-TO-LAST row dead-ends downward: the last row can be shorter
 * (it never scales up to fill), and UIKit only moves focus to a candidate intersecting the
 * focused frame's projection, so a card starting past the last row's right edge has no
 * natural Down target and must name the last card explicitly (nextFocusDown).
 */
export function isStrandedAboveLastRow<T>(card: PackedCard<T>, lastRowWidth: number): boolean {
  return card.x >= lastRowWidth;
}
