import { useCallback } from "react";
import { flushSync } from "react-dom";
import { ArchitectureSection } from "./architecture/ArchitectureSection";
import { DeepContext } from "./components/deepContext";
import { HeroBand } from "./components/HeroBand";
import { PrintLayer } from "./components/PrintLayer";
import { holdPosition } from "./components/holdPosition";
import { SiteFooter } from "./components/SiteFooter";
import { TopBar } from "./components/TopBar";
import { useActiveSection } from "./components/useActiveSection";
import { useDeepMode } from "./components/useDeepMode";
import { useInitialSection } from "./components/useInitialSection";
import { useTheme } from "./components/useTheme";
import { SECTION_IDS } from "./content/sections";
import { LiveSection } from "./live/LiveSection";
import { LiveSessionProvider } from "./live/session/LiveSessionProvider";
import { RunAnnouncer } from "./live/session/RunPlaybackProvider";
import { PerformanceSection } from "./performance/PerformanceSection";
import { ReplaySection } from "./replay/ReplaySection";
import { BuiltSection } from "./timeline/BuiltSection";
import { VerificationSection } from "./verification/VerificationSection";

export default function App() {
  const [deep, setDeep] = useDeepMode();
  const [theme, toggleTheme] = useTheme();
  const active = useActiveSection(SECTION_IDS);
  useInitialSection();
  // Deep mode opens every drawer, which can grow the page above the visitor: keep the section they are reading in place
  const changeDeep = useCallback(
    (next: boolean) => {
      holdPosition(active ? document.getElementById(active) : null, () => flushSync(() => setDeep(next)));
    },
    [active, setDeep],
  );

  return (
    <DeepContext.Provider value={deep}>
      <LiveSessionProvider>
        <PrintLayer />
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <TopBar active={active} deep={deep} onDeepChange={changeDeep} theme={theme} onThemeToggle={toggleTheme} />
        <main id="main" tabIndex={-1}>
          <HeroBand />
          <ReplaySection />
          <LiveSection />
          <PerformanceSection />
          <ArchitectureSection />
          <VerificationSection />
          <BuiltSection />
          <RunAnnouncer />
        </main>
        <SiteFooter />
      </LiveSessionProvider>
    </DeepContext.Provider>
  );
}
