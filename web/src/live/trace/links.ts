export interface Link {
  /** index into WindowSummary.links: from * 4 + port */
  id: number;
  from: number;
  to: number;
  /** 0 north, 1 east, 2 south, 3 west */
  port: 0 | 1 | 2 | 3;
}

/**
 * Every directed link whose far end exists. Node i sits at x = i % w, y = floor(i / w); east is x + 1 and
 * north is y + 1 (rtl/noc_mesh.v). Edge ports carry no traffic and are left out.
 */
export function meshLinks(w: number, h: number): Link[] {
  const links: Link[] = [];
  for (let i = 0; i < w * h; i++) {
    const x = i % w;
    const y = Math.floor(i / w);
    if (y < h - 1) links.push({ id: i * 4, from: i, to: i + w, port: 0 });
    if (x < w - 1) links.push({ id: i * 4 + 1, from: i, to: i + 1, port: 1 });
    if (y > 0) links.push({ id: i * 4 + 2, from: i, to: i - w, port: 2 });
    if (x > 0) links.push({ id: i * 4 + 3, from: i, to: i - 1, port: 3 });
  }
  return links;
}
