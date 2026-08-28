/**
 * Fisher-Yates, on a copy.
 *
 * Every position is equally likely, which the `sort(() => Math.random() - 0.5)` shorthand is
 * not: comparison sorts assume a consistent comparator and bias the result badly.
 */
export function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
