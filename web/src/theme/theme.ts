export type Theme = "dark" | "light";

/** index.html carries a copy of this key and of the two colors in its inline script; inlineTheme.test.ts keeps them equal. */
export const THEME_KEY = "hwgemm-theme";
export const THEME_COLOR: Record<Theme, string> = { dark: "#080b10", light: "#f7f9fb" };

export function parseTheme(value: unknown): Theme {
  return value === "light" ? "light" : "dark";
}

function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function readSavedTheme(storage: Pick<Storage, "getItem"> | undefined = browserStorage()): Theme {
  try {
    return parseTheme(storage?.getItem(THEME_KEY));
  } catch {
    return "dark";
  }
}

export function saveTheme(theme: Theme, storage: Pick<Storage, "setItem"> | undefined = browserStorage()): void {
  try {
    storage?.setItem(THEME_KEY, theme);
  } catch {
    // a blocked or full storage only means the choice is not remembered
  }
}

export function applyTheme(theme: Theme, doc: Document = document): void {
  doc.documentElement.dataset.theme = theme;
  doc.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
}
