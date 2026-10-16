import summary from "../data/generated/summary.json";
import { formatInt, formatPercent, formatRatio } from "../format";

interface Tile {
  value: string;
  label: string;
  claim: string;
}

const { lm, cifar } = summary;

const TILES: Tile[] = [
  {
    value: `${lm.stories} × ${lm.steps}`,
    label: "Stories on chip, tokens each",
    claim:
      "Bit-exact against the integer reference at every level of the verification ladder. The run writes its outputs only if every check passes.",
  },
  {
    value: formatInt(lm.meshes["2x2_t256"]!.cycles),
    label: "Cycles, 2x2 mesh, temperature 1.0",
    claim: "The whole run from one start pulse, counted by the RTL's own performance counters.",
  },
  {
    value: formatPercent(cifar.int8Accuracy),
    label: "CIFAR-10 int8 accuracy",
    claim: `${cifar.images} test images on the ${cifar.mesh} mesh, with the logits checked bit for bit against the reference.`,
  },
  {
    value: formatRatio(lm.scalingVsOneByOne["2x2"]),
    label: "Scaling, 2x2 over 1x1",
    claim: `It saturates: 4x4 reaches only ${formatRatio(lm.scalingVsOneByOne["4x4"])}. The performance section explains why.`,
  },
];

export function HeroStrip() {
  return (
    <div className="hero">
      {TILES.map((tile) => (
        <div className="tile" key={tile.label}>
          <p className="tile-value">{tile.value}</p>
          <p className="tile-label">{tile.label}</p>
          <p className="tile-claim">{tile.claim}</p>
        </div>
      ))}
    </div>
  );
}
