import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { SECTIONS } from "../content/sections";
import { REPO_URL } from "../content/timeline";
import { usePrefersReducedMotion } from "../replay/hooks";
import type { Theme } from "../theme/theme";
import { DeepToggle } from "./DeepToggle";
import { ThemeToggle } from "./ThemeToggle";

export interface TopBarProps {
  active: string | null;
  deep: boolean;
  onDeepChange(next: boolean): void;
  theme: Theme;
  onThemeToggle(): void;
}

/** The scroll offset that centres a link in a horizontally scrolling strip, never negative. */
export function centerOffset(linkLeft: number, linkWidth: number, stripWidth: number): number {
  return Math.max(0, linkLeft - (stripWidth - linkWidth) / 2);
}

const GLYPH = (
  <svg viewBox="0 0 64 64" width="22" height="22" aria-hidden="true">
    <g fill="currentColor">
      <rect x="8" y="8" width="21" height="21" rx="4" />
      <rect x="35" y="8" width="21" height="21" rx="4" opacity=".55" />
      <rect x="8" y="35" width="21" height="21" rx="4" opacity=".55" />
      <rect x="35" y="35" width="21" height="21" rx="4" />
    </g>
  </svg>
);

const GITHUB = (
  <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" fill="currentColor">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

export function TopBar({ active, deep, onDeepChange, theme, onThemeToggle }: TopBarProps) {
  const stripRef = useRef<HTMLUListElement>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || !active) return;
    const link = strip.querySelector<HTMLElement>(`[data-section="${active}"]`);
    if (!link) return;
    strip.scrollTo?.({
      left: centerOffset(
        link.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft,
        link.offsetWidth,
        strip.clientWidth,
      ),
      behavior: reduced ? "auto" : "smooth",
    });
  }, [active, reduced]);

  const toTop = (event: ReactMouseEvent) => {
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
    const { pathname, search } = window.location;
    window.history.replaceState(null, "", `${pathname}${search}`);
  };

  return (
    <header className="topbar">
      <div className="topbar-row">
        <a className="wordmark" href="#" onClick={toTop}>
          {GLYPH}
          <span>hw-GEMM</span>
        </a>
        <nav className="topbar-nav" aria-label="Sections">
          <ul ref={stripRef}>
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  data-section={section.id}
                  aria-current={active === section.id ? "location" : undefined}
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="topbar-actions">
          <a className="topbar-link" href={REPO_URL} target="_blank" rel="noopener noreferrer">
            {GITHUB}
            <span className="vh-narrow">GitHub</span>
          </a>
          <DeepToggle deep={deep} onChange={onDeepChange} />
          <ThemeToggle theme={theme} onToggle={onThemeToggle} />
        </div>
      </div>
    </header>
  );
}
