import { TILE, controllerCenter, linkGeometry, tileCenter } from "./sceneLayout";

/** Pixels per scene unit, and the margin around the board. */
const S = 40;
const PAD = 16;
const CONTROLLER_W = TILE * 0.9;
const CONTROLLER_D = TILE * 1.4;
const LINK = 0.09;

interface Box {
  x: number;
  z: number;
  w: number;
  d: number;
}

/**
 * The board seen from above, drawn as plain SVG with the same layout numbers as the 3D scene (node 0 nearest the viewer,
 * the controller beside it). It is what the stage shows from first paint until, or instead of, the 3D scene.
 */
export function MeshBoard({ w, h }: { w: number; h: number }) {
  const tiles: Box[] = Array.from({ length: w * h }, (_, n) => {
    const c = tileCenter(w, h, n);
    return { x: c.x - TILE / 2, z: c.z - TILE / 2, w: TILE, d: TILE };
  });
  const controller = controllerCenter(w, h);
  const node0 = tileCenter(w, h, 0);
  const controllerBox: Box = { x: controller.x - CONTROLLER_W / 2, z: controller.z - CONTROLLER_D / 2, w: CONTROLLER_W, d: CONTROLLER_D };
  const links: Box[] = linkGeometry(w, h).map((g) =>
    g.axis === "x"
      ? { x: g.center.x - g.length / 2, z: g.center.z - LINK / 2, w: g.length, d: LINK }
      : { x: g.center.x - LINK / 2, z: g.center.z - g.length / 2, w: LINK, d: g.length },
  );
  links.push({ x: controller.x + CONTROLLER_W / 2, z: node0.z - LINK / 2, w: node0.x - TILE / 2 - (controller.x + CONTROLLER_W / 2), d: LINK });

  const all = [...tiles, controllerBox, ...links];
  const minX = Math.min(...all.map((b) => b.x));
  const maxX = Math.max(...all.map((b) => b.x + b.w));
  const minZ = Math.min(...all.map((b) => b.z));
  const maxZ = Math.max(...all.map((b) => b.z + b.d));
  const width = (maxX - minX) * S + 2 * PAD;
  const height = (maxZ - minZ) * S + 2 * PAD;
  const rect = (b: Box, className: string, key: string | number) => (
    <rect
      key={key}
      className={className}
      x={(b.x - minX) * S + PAD}
      y={(b.z - minZ) * S + PAD}
      width={b.w * S}
      height={b.d * S}
      rx={className === "board-tile" ? 5 : 2}
    />
  );

  return (
    <svg className="mesh-board" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {links.map((b, i) => rect(b, "board-link", `l${i}`))}
      {rect(controllerBox, "board-controller", "c")}
      {tiles.map((b, i) => rect(b, "board-tile", `t${i}`))}
    </svg>
  );
}
