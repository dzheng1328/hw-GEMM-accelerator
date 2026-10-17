import { REPO_URL } from "../content/timeline";

export const AUTHOR_URL = "https://github.com/dzheng1328";
export const LINKEDIN_URL = "https://www.linkedin.com/in/d-zheng";
export const EMAIL = "davezheng1328@gmail.com";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <p>
        Built by Dave Zheng. The numbers come from the repository&apos;s recorded simulation results (<code>docs/perf</code>)
        and its decision log (<code>docs/decisions.md</code>), and tests check the page against both.
      </p>
      <p>
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
          Source on GitHub
        </a>
        <span aria-hidden="true"> · </span>
        <a href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">
          MIT license
        </a>
        <span aria-hidden="true"> · </span>
        <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer">
          @dzheng1328
        </a>
        <span aria-hidden="true"> · </span>
        <a href={LINKEDIN_URL} target="_blank" rel="noopener noreferrer">
          LinkedIn
        </a>
        <span aria-hidden="true"> · </span>
        <a href={`mailto:${EMAIL}`}>{EMAIL}</a>
      </p>
    </footer>
  );
}
