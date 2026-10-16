import type { ReactNode } from "react";
import { Drawer } from "./Drawer";

export interface SectionProps {
  id: string;
  title: string;
  headline: string;
  drawer?: { summary: string; body: ReactNode };
  children?: ReactNode;
}

export function Section({ id, title, headline, drawer, children }: SectionProps) {
  return (
    <section id={id} className="section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      <p className="headline">{headline}</p>
      {children}
      {drawer ? <Drawer summary={drawer.summary}>{drawer.body}</Drawer> : null}
    </section>
  );
}
