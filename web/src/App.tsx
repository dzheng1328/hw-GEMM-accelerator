import { ArchitectureSection } from "./architecture/ArchitectureSection";
import { DeepContext } from "./components/deepContext";
import { HeroBand } from "./components/HeroBand";
import { SiteFooter } from "./components/SiteFooter";
import { TopBar } from "./components/TopBar";
import { useActiveSection } from "./components/useActiveSection";
import { useDeepMode } from "./components/useDeepMode";
import { useTheme } from "./components/useTheme";
import { SECTION_IDS } from "./content/sections";
import { LiveSection } from "./live/LiveSection";
import { PerformanceSection } from "./performance/PerformanceSection";
import { ReplaySection } from "./replay/ReplaySection";
import { BuiltSection } from "./timeline/BuiltSection";
import { VerificationSection } from "./verification/VerificationSection";

export default function App() {
  const [deep, setDeep] = useDeepMode();
  const [theme, toggleTheme] = useTheme();
  const active = useActiveSection(SECTION_IDS);

  return (
    <DeepContext.Provider value={deep}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <TopBar active={active} deep={deep} onDeepChange={setDeep} theme={theme} onThemeToggle={toggleTheme} />
      <main id="main" tabIndex={-1}>
        <HeroBand />
        <ReplaySection />
        <LiveSection />
        <PerformanceSection />
        <ArchitectureSection />
        <VerificationSection />
        <BuiltSection />
      </main>
      <SiteFooter />
    </DeepContext.Provider>
  );
}
