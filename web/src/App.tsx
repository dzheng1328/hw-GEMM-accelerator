import { DeepContext } from "./components/deepContext";
import { DeepToggle } from "./components/DeepToggle";
import { HeroStrip } from "./components/HeroStrip";
import { Section } from "./components/Section";
import { useDeepMode } from "./components/useDeepMode";
import { PerformanceSection } from "./performance/PerformanceSection";
import { ReplaySection } from "./replay/ReplaySection";
import { BuiltSection } from "./timeline/BuiltSection";

const SOON = "Under construction.";

export default function App() {
  const [deep, setDeep] = useDeepMode();

  return (
    <DeepContext.Provider value={deep}>
      <div className="page">
        <header className="site-header">
          <div>
            <h1>hw-GEMM accelerator</h1>
            <p className="tagline">
              A systolic GEMM accelerator with a command processor, a vector unit and a tiny language
              model, simulated end to end in RTL.
            </p>
          </div>
          <DeepToggle deep={deep} onChange={setDeep} />
        </header>
        <main>
          <HeroStrip />
          <ReplaySection />
          <PerformanceSection />
          <Section
            id="architecture"
            title="The chip"
            headline="A mesh of GEMM tiles behind one command processor, with a vector unit beside it."
            drawer={{ summary: "Go deeper", body: <p className="placeholder">{SOON}</p> }}
          >
            <p className="placeholder">{SOON}</p>
          </Section>
          <Section
            id="verification"
            title="Why you can believe it"
            headline="Model, integer reference, golden executor and RTL agree bit for bit."
            drawer={{ summary: "Go deeper", body: <p className="placeholder">{SOON}</p> }}
          >
            <p className="placeholder">{SOON}</p>
          </Section>
          <BuiltSection />
        </main>
      </div>
    </DeepContext.Provider>
  );
}
