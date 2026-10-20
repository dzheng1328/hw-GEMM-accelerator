import type { HTMLAttributes, Ref } from "react";

type SheetBase = Omit<HTMLAttributes<HTMLElement>, "role" | "tabIndex"> & { as?: "div" | "section" | "figure"; ref?: Ref<HTMLElement> };
export type SheetProps = (SheetBase & { scroll?: false; label?: undefined }) | (SheetBase & { scroll: true; label: string });

/** A sheet of real washi paper: its own colour scope (sheets.css). A scrolling sheet is a named, focusable region. */
export function Sheet({ as: Tag = "div", scroll, label, className, children, ref, ...rest }: SheetProps) {
  const classes = ["sheet", scroll ? "sheet-scroll" : "", className ?? ""].filter(Boolean).join(" ");
  const aria = scroll ? { role: "region", "aria-label": label, tabIndex: 0 } : {};
  // the tag is one of three elements, so the ref is typed by their common base, HTMLElement
  return (
    <Tag ref={ref as never} className={classes} {...aria} {...rest}>
      {children}
    </Tag>
  );
}
