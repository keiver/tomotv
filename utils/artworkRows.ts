/**
 * Justified row packing for mixed-shape card grids (folder browsing). ONE height per row,
 * never uneven: a row renders at the tallest shape present in it — wide cards in a poster
 * row grow to match — and the whole row is then scaled uniformly so it EXACTLY fills the
 * available width. No trailing gap, no distortion (aspect ratios are preserved; only the
 * scale changes). The final row never scales up, so a lone straggler card stays card-sized.
 * Pure math at pack time — no measurement, no second layout pass — so the focus rules built
 * on it are testable.
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
  interface Group {
    items: T[];
    ratios: number[];
    sumRatio: number;
    /** Tallest nominal inner (padding-less) height in the group — the row's unified height. */
    maxInner: number;
  }

  // The uniform scale at which a group, rendered at its unified height, exactly fills the width.
  const scaleFor = (group: { sumRatio: number; maxInner: number }, count: number) => (availableWidth - count * 2 * cardPadding) / (group.maxInner * group.sumRatio);

  // Phase 1: split items into row groups. Widths are always evaluated at the group's
  // CURRENT unified height (adding a poster to a wide row grows the wide cards too), and
  // the break lands where the justified scale is closest to 1 (one-card lookahead).
  const groups: Group[] = [];
  let current: Group = { items: [], ratios: [], sumRatio: 0, maxInner: 0 };

  const close = () => {
    if (current.items.length > 0) {
      groups.push(current);
      current = { items: [], ratios: [], sumRatio: 0, maxInner: 0 };
    }
  };

  for (const item of items) {
    const { ratio, height } = metricsOf(item);
    const inner = height - 2 * cardPadding;
    const withItem = {
      sumRatio: current.sumRatio + ratio,
      maxInner: Math.max(current.maxInner, inner),
    };
    const count = current.items.length;
    const naturalWithItem = withItem.maxInner * withItem.sumRatio + (count + 1) * 2 * cardPadding;
    if (count > 0 && naturalWithItem > availableWidth) {
      const withScale = scaleFor(withItem, count + 1);
      const withoutScale = scaleFor(current, count);
      if (Math.abs(withScale - 1) < Math.abs(withoutScale - 1)) {
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
  // scales up; it only shrinks when its natural width overflows (a lone card wider than
  // the viewport).
  return groups.map((group, groupIndex) => {
    const isLast = groupIndex === groups.length - 1;
    const exact = scaleFor(group, group.items.length);
    const scale = isLast ? Math.min(1, exact) : Math.min(Math.max(exact, MIN_SCALE), MAX_SCALE);

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
