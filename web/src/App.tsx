import { ArchitectureSection } from "./architecture/ArchitectureSection";
import { DeepContext } from "./components/deepContext";
import { DeepToggle } from "./components/DeepToggle";
import { HeroStrip } from "./components/HeroStrip";
import { useDeepMode } from "./components/useDeepMode";
import { LiveSection } from "./live/LiveSection";
import { PerformanceSection } from "./performance/PerformanceSection";
import { ReplaySection } from "./replay/ReplaySection";
import { BuiltSection } from "./timeline/BuiltSection";
import { VerificationSection } from "./verification/VerificationSection";

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
          <LiveSection />
          <PerformanceSection />
          <ArchitectureSection />
          <VerificationSection />
          <BuiltSection />
        </main>
      </div>
    </DeepContext.Provider>
  );
}
