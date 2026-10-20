import { useRef, type ReactNode } from "react";
import { drawRule } from "../motion/primitives";
import { useMotion } from "../motion/useMotion";
import { Drawer } from "./Drawer";

export interface SectionProps {
  id: string;
  title: string;
  headline: string;
  drawer?: { summary: string; body: ReactNode };
  children?: ReactNode;
}

export function Section({ id, title, headline, drawer, children }: SectionProps) {
  const rule = useRef<HTMLSpanElement>(null);
  useMotion(rule, (g, el) => drawRule(g, el));
  return (
    <section id={id} className="band" aria-labelledby={`${id}-title`}>
      <div className="band-inner">
        <h2 id={`${id}-title`}>{title}</h2>
        <span ref={rule} className="band-rule" aria-hidden="true" />
        <p className="headline">{headline}</p>
        {children}
        {drawer ? <Drawer summary={drawer.summary}>{drawer.body}</Drawer> : null}
      </div>
    </section>
  );
}
