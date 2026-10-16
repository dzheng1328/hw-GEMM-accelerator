import summary from "../data/generated/summary.json";
import { performance } from "../performance/data";

/** The line under a ladder: the amount of evidence, from the generated data and never typed by hand. */
export function ladderEvidence(id: "cifar" | "lm"): string {
  if (id === "cifar") {
    return `${performance.cifar.images} test images, bit-exact at every level of the ladder.`;
  }
  return `${summary.lm.stories} stories of ${summary.lm.steps} tokens at temperature 0 and 1.0, bit-exact from the integer reference down to the RTL.`;
}
