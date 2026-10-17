import { useCallback, useState } from "react";
import { applyTheme, parseTheme, saveTheme, type Theme } from "../theme/theme";

/** The inline script in index.html has already put the saved theme on <html> before React runs; this follows and changes it. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => parseTheme(document.documentElement.dataset.theme));
  const toggle = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    saveTheme(next);
    setTheme(next);
  }, [theme]);
  return [theme, toggle];
}
