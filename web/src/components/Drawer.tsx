import { useContext, useState, type ReactNode } from "react";
import { DeepContext } from "./deepContext";

export function Drawer({ summary, children }: { summary: string; children: ReactNode }) {
  const deep = useContext(DeepContext);
  const [userOpen, setUserOpen] = useState(false);

  return (
    <details className="drawer" open={deep || userOpen}>
      <summary
        onClick={(event) => {
          event.preventDefault();
          if (!deep) setUserOpen((open) => !open);
        }}
      >
        {summary}
      </summary>
      <div className="drawer-body">{children}</div>
    </details>
  );
}
