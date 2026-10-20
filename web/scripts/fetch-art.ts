import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { assertPublicDomain, encodeWithinBudget, findPaperRegion, percentileColor, trimRegion, type MetObject, type Trim } from "./art";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(web, "scripts", "art.manifest.json"), "utf8")) as {
  assets: { role: string; objectId: number; trim?: Trim; paperCrop?: boolean; widths: number[]; maxBytes: Record<string, number> }[];
};
const API = "https://collectionapi.metmuseum.org/public/collection/v1/objects";
const outDir = join(web, "public", "art");
mkdirSync(outDir, { recursive: true });

async function getBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

const objects = new Map<number, { meta: MetObject; original: Buffer }>();
for (const id of new Set(manifest.assets.map((a) => a.objectId))) {
  const meta = JSON.parse((await getBuffer(`${API}/${id}`)).toString("utf8")) as MetObject;
  assertPublicDomain(meta);
  objects.set(id, { meta, original: await getBuffer(meta.primaryImage) });
  console.log(`fetched ${id}: ${meta.title}`);
}

const assets = [];
for (const spec of manifest.assets) {
  const { original } = objects.get(spec.objectId)!;
  const info = await sharp(original).metadata();
  let region = { left: 0, top: 0, width: info.width!, height: info.height! };
  if (spec.trim) region = trimRegion(info.width!, info.height!, spec.trim);
  if (spec.paperCrop) {
    const small = await sharp(original).greyscale().resize({ width: 256 }).raw().toBuffer({ resolveWithObject: true });
    const win = Math.floor(small.info.width / 4);
    // the scroll's paper is a mid tan (mean grey about 160) on black mounting, so 100 only has to rule out the black
    const found = findPaperRegion(new Uint8Array(small.data), small.info.width, small.info.height, win, 100);
    const scale = info.width! / small.info.width;
    region = { left: Math.round(found.x * scale), top: Math.round(found.y * scale), width: Math.round(found.size * scale), height: Math.round(found.size * scale) };
  }
  // a sharp pipeline is single-use, and every output starts from the original so nothing is re-encoded twice
  const crop = () => sharp(original).extract(region);

  const files = [];
  for (const width of spec.widths) {
    const target = Math.min(width, region.width);
    const encoded = await encodeWithinBudget(
      (quality) => crop().resize({ width: target }).webp({ quality, effort: 6 }).toBuffer(),
      spec.maxBytes[String(width)]!,
    );
    const name = `${spec.role}-${width}.webp`;
    writeFileSync(join(outDir, name), encoded.buffer);
    const out = await sharp(encoded.buffer).metadata();
    // the width recorded is the real one: a crop narrower than the request is not enlarged
    files.push({ width: out.width!, height: out.height!, path: `/art/${name}`, bytes: encoded.buffer.length });
    console.log(`wrote ${name}: ${out.width}x${out.height}, ${encoded.buffer.length} bytes at quality ${encoded.quality}`);
  }

  const stats = await crop().resize({ width: 256 }).removeAlpha().raw().toBuffer();
  // a blur preview is for a full-bleed print that loads late; the small paper crop under the sheets needs none
  const blur = spec.paperCrop ? null : await crop().resize({ width: 24 }).webp({ quality: 40 }).toBuffer();
  assets.push({
    role: spec.role,
    objectId: spec.objectId,
    files,
    ...(blur ? { blur: `data:image/webp;base64,${blur.toString("base64")}` } : {}),
    brightest: percentileColor(new Uint8Array(stats), 0.99),
    darkest: percentileColor(new Uint8Array(stats), 0.01),
  });
}

const credits = [...objects.values()].map(({ meta, original }) => ({
  objectId: meta.objectID,
  title: meta.title,
  artist: meta.artistDisplayName,
  date: meta.objectDate,
  creditLine: meta.creditLine,
  objectUrl: meta.objectURL,
  isPublicDomain: meta.isPublicDomain,
  sha256: createHash("sha256").update(original).digest("hex"),
}));

writeFileSync(
  join(web, "src", "data", "generated", "attributions.json"),
  JSON.stringify(
    {
      _generated: { script: "web/scripts/fetch-art.ts", regenerate: "npm run build:art (in web/)", note: "generated, do not edit by hand" },
      licence: "Public domain, The Metropolitan Museum of Art Open Access (CC0)",
      credits,
      assets,
    },
    null,
    2,
  ) + "\n",
);
console.log("wrote attributions.json");
