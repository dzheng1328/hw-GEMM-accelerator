import { HeroStrip } from "./HeroStrip";

/** The top of the page. `.hero-display` is the slot sub-project B fills with the live chip. */
export function HeroBand() {
  return (
    <div className="hero-band">
      <div className="band-inner">
        <h1>hw-GEMM accelerator</h1>
        <p className="tagline">
          A systolic GEMM accelerator with a command processor, a vector unit and a tiny language model, simulated end to end
          in RTL.
        </p>
        <div className="hero-display">
          <HeroStrip />
        </div>
      </div>
    </div>
  );
}
