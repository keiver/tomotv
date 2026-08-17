/**
 * Row packing for mixed-shape card grids (folder browsing): items flow left to right into
 * rows of one fixed height, each card as wide as its slot ratio dictates, wrapping when the
 * next card would overflow. Left-aligned with a ragged right edge — cards are never scaled
 * or cropped to justify the row. Pure math so the focus rules built on it are testable.
 */

export interface PackedCard<T> {
  item: T;
  /** Card width in px (outer, padding included). */
  width: number;
  /** Left edge within the row, in px from the content's left edge. */
  x: number;
}

export interface PackedRow<T> {
  cards: PackedCard<T>[];
  /** Total occupied width in px (right edge of the last card). */
  width: number;
}

/**
 * @param availableWidth content width the rows may fill (window minus edge padding)
 * @param cardHeight the shared row card height (see slotRowCardHeight)
 * @param ratioOf slot aspect ratio (w/h) for an item's card (see artworkSlotRatio)
 * @param cardPadding the card component's outer padding (see slotCardPadding)
 */
export function packArtworkRows<T>(items: readonly T[], availableWidth: number, cardHeight: number, ratioOf: (item: T) => number, cardPadding: number): PackedRow<T>[] {
  const rows: PackedRow<T>[] = [];
  let current: PackedCard<T>[] = [];
  let x = 0;

  const closeRow = () => {
    if (current.length > 0) {
      rows.push({ cards: current, width: x });
      current = [];
      x = 0;
    }
  };

  for (const item of items) {
    const width = (cardHeight - 2 * cardPadding) * ratioOf(item) + 2 * cardPadding;
    // Wrap when the card would overflow — but a row always takes at least one card, so a
    // card wider than the viewport still renders instead of looping forever.
    if (current.length > 0 && x + width > availableWidth) {
      closeRow();
    }
    current.push({ item, width, x });
    x += width;
  }
  closeRow();

  return rows;
}

/**
 * Whether a card in the SECOND-TO-LAST row dead-ends downward: the last row is shorter, and
 * UIKit only moves focus to a candidate intersecting the focused frame's projection, so a
 * card starting past the last row's right edge has no natural Down target and must name the
 * last card explicitly (nextFocusDown).
 */
export function isStrandedAboveLastRow<T>(card: PackedCard<T>, lastRowWidth: number): boolean {
  return card.x >= lastRowWidth;
}
