import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { DeepContext } from "./deepContext";
import { OPEN_DRAWER_EVENT } from "./drawerEvents";

export function Drawer({ summary, children }: { summary: string; children: ReactNode }) {
  const deep = useContext(DeepContext);
  const [userOpen, setUserOpen] = useState(false);
  const ref = useRef<HTMLDetailsElement>(null);

  // a proof jump scrolls right after it asks, so the drawer must be open by the time the event returns
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const open = () => flushSync(() => setUserOpen(true));
    element.addEventListener(OPEN_DRAWER_EVENT, open);
    return () => element.removeEventListener(OPEN_DRAWER_EVENT, open);
  }, []);

  return (
    <details ref={ref} className="drawer" open={deep || userOpen}>
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
