import type { ReactNode } from "react";
import { isAlternate, kicker, sectionMeta } from "../content/sections";
import { Drawer } from "./Drawer";

export interface SectionProps {
  id: string;
  title: string;
  headline: string;
  drawer?: { summary: string; body: ReactNode };
  children?: ReactNode;
}

export function Section({ id, title, headline, drawer, children }: SectionProps) {
  const meta = sectionMeta(id);
  return (
    <section id={id} className={isAlternate(id) ? "band band-alt" : "band"} aria-labelledby={`${id}-title`}>
      <div className="band-inner">
        {meta ? (
          <p className="kicker" aria-hidden="true">
            {kicker(meta)}
          </p>
        ) : null}
        <h2 id={`${id}-title`}>{title}</h2>
        <p className="headline">{headline}</p>
        {children}
        {drawer ? <Drawer summary={drawer.summary}>{drawer.body}</Drawer> : null}
      </div>
    </section>
  );
}
