/**
 * Runs `apply` (a change that can resize content above the visitor, such as Deep mode opening every drawer) and then
 * scrolls so `anchor` is back where it was in the window. With no anchor, as over the hero, nothing can have moved
 * the visitor, so the change is just applied. The scroll is instant: smooth scrolling would animate the correction.
 */
export function holdPosition(
  anchor: Element | null,
  apply: () => void,
  scrollBy: (options: ScrollToOptions) => void = (options) => window.scrollBy(options),
): void {
  const before = anchor?.getBoundingClientRect().top;
  apply();
  if (anchor === null || before === undefined) return;
  const delta = anchor.getBoundingClientRect().top - before;
  if (delta !== 0) scrollBy({ top: delta, behavior: "instant" });
}
