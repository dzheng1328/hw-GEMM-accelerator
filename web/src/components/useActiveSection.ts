import { useEffect, useState } from "react";

/** A thin strip a little above the middle of the window: the section that overlaps it is the one being read. */
export const TRIGGER_MARGIN = "-45% 0px -54% 0px";

export interface ObserverLike {
  observe(target: Element): void;
  disconnect(): void;
}
export type ObserverFactory = (callback: IntersectionObserverCallback, init: IntersectionObserverInit) => ObserverLike;

export interface ActiveEnv {
  createObserver: ObserverFactory;
  isAtBottom(): boolean;
}

export const defaultEnv: ActiveEnv = {
  createObserver: (callback, init) => new IntersectionObserver(callback, init),
  isAtBottom: () => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2,
};

/** The topmost id that crosses the line; null when none does (over the hero). */
export function pickActive(ids: readonly string[], crossing: ReadonlySet<string>): string | null {
  return ids.find((id) => crossing.has(id)) ?? null;
}

/**
 * The id of the section being read. It observes sizes, so it stays right when Deep mode opens drawers or lazy content
 * changes a section's height. At the very bottom of the page the last section is active.
 */
export function useActiveSection(ids: readonly string[], env: ActiveEnv = defaultEnv): string | null {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (env === defaultEnv && typeof IntersectionObserver === "undefined") return;
    const crossing = new Set<string>();
    let bottom = false;
    const publish = () => setActive(bottom ? (ids[ids.length - 1] ?? null) : pickActive(ids, crossing));

    const observer = env.createObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).id;
          if (entry.isIntersecting) crossing.add(id);
          else crossing.delete(id);
        }
        publish();
      },
      { rootMargin: TRIGGER_MARGIN, threshold: 0 },
    );
    for (const id of ids) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }

    const onScroll = () => {
      const now = env.isAtBottom();
      if (now !== bottom) {
        bottom = now;
        publish();
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, [ids, env]);

  return active;
}
