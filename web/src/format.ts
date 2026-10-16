export function formatInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function formatPercent(fraction: number, digits = 2): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function formatRatio(ratio: number): string {
  return `${ratio.toFixed(2)}x`;
}
