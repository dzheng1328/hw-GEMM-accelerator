import { useRef, type Ref } from "react";
import { PROOF, type ProofKey } from "../content/proof";
import summary from "../data/generated/summary.json";
import { formatInt, formatPercent, formatRatio } from "../format";
import { sweepIn } from "../motion/primitives";
import { useMotion } from "../motion/useMotion";
import { CountFigure } from "./CountFigure";
import { onProofClick } from "./proofJump";

interface Tile {
  value: string;
  /** set on the lead tile: the number that counts up */
  count?: number;
  label: string;
  claim: string;
  /** the evidence the tile links to */
  proof: ProofKey;
}

const { lm, cifar } = summary;

const TILES: Tile[] = [
  {
    value: formatInt(lm.meshes["2x2_t256"]!.cycles),
    count: lm.meshes["2x2_t256"]!.cycles,
    label: "Cycles, 2x2 mesh, temperature 1.0",
    claim: "The whole run from one start pulse, counted by the RTL's own performance counters.",
    proof: "cycles",
  },
  {
    value: `${lm.stories} × ${lm.steps}`,
    label: "Stories on chip, tokens each",
    claim:
      "Bit-exact against the integer reference at every level of the verification ladder. The run writes its outputs only if every check passes.",
    proof: "stories",
  },
  {
    value: formatPercent(cifar.int8Accuracy),
    label: "CIFAR-10 int8 accuracy",
    claim: `${cifar.images} test images on the ${cifar.mesh} mesh, with the logits checked bit for bit against the reference.`,
    proof: "cifar",
  },
  {
    value: formatRatio(lm.scalingVsOneByOne["2x2"]),
    label: "Scaling, 2x2 over 1x1",
    claim: `It saturates: 4x4 reaches only ${formatRatio(lm.scalingVsOneByOne["4x4"])}. The performance section explains why.`,
    proof: "scaling",
  },
];

function TileBody({ tile, ref }: { tile: Tile; ref?: Ref<HTMLAnchorElement> }) {
  const { id } = PROOF[tile.proof];
  return (
    <a ref={ref} className="tile" href={`#${id}`} onClick={onProofClick(id)}>
      <p className="tile-value">{tile.count !== undefined ? <CountFigure value={tile.count} text={tile.value} /> : tile.value}</p>
      <p className="tile-label">{tile.label}</p>
      <p className="tile-claim">
        {tile.claim} <span className="tile-proof">See the proof</span>
      </p>
    </a>
  );
}

/** The secondary tiles sweep in from the right. */
function SweepTile({ tile }: { tile: Tile }) {
  const ref = useRef<HTMLAnchorElement>(null);
  useMotion(ref, (g, el) => sweepIn(g, el, { from: "right" }));
  return <TileBody tile={tile} ref={ref} />;
}

export function HeroStrip() {
  return (
    <div className="hero">
      {/* the lead figure counts up instead (CountFigure) and is never hidden, so it has no sweep */}
      {TILES.map((tile, i) => (i === 0 ? <TileBody key={tile.label} tile={tile} /> : <SweepTile key={tile.label} tile={tile} />))}
    </div>
  );
}
