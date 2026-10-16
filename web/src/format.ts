export function formatInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function formatPercent(fraction: number, digits = 2): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function formatRatio(ratio: number): string {
  return `${ratio.toFixed(2)}x`;
}

export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
