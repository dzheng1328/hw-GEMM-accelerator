/** The dark block is the first `:root { ... }`; the light block is `:root[data-theme="light"] { ... }`. A missing block throws, so a test can never pass on an empty match. */
export function themeBlocks(css: string): { dark: string; light: string } {
  const dark = /:root\s*\{([^}]*)\}/.exec(css)?.[1];
  const light = /:root\[data-theme="light"\]\s*\{([^}]*)\}/.exec(css)?.[1];
  if (dark === undefined || light === undefined) {
    throw new Error('tokens.css needs a :root block and a :root[data-theme="light"] block');
  }
  return { dark, light };
}
