import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { DeepContext } from "./deepContext";
import { OPEN_DRAWER_EVENT } from "./drawerEvents";

export function Drawer({ summary, children }: { summary: string; children: ReactNode }) {
  const deep = useContext(DeepContext);
  // two states: what the visitor left it at outside Deep mode (which comes back when Deep mode goes off), and what they
  // did inside Deep mode, which starts open and ends whenever Deep mode changes
  const [userOpen, setUserOpen] = useState(false);
  const [deepOpen, setDeepOpen] = useState(true);
  const [wasDeep, setWasDeep] = useState(deep);
  if (wasDeep !== deep) {
    setWasDeep(deep);
    setDeepOpen(true);
  }
  const open = deep ? deepOpen : userOpen;
  const setOpen = deep ? setDeepOpen : setUserOpen;
  const ref = useRef<HTMLDetailsElement>(null);

  // a proof jump scrolls right after it asks, so the drawer must be open by the time the event returns
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const openNow = () => flushSync(() => setOpen(true));
    element.addEventListener(OPEN_DRAWER_EVENT, openNow);
    return () => element.removeEventListener(OPEN_DRAWER_EVENT, openNow);
  }, [setOpen]);

  return (
    <details
      ref={ref}
      className="drawer"
      open={open}
      // the browser can open the element itself (find-in-page does), and the state must follow or the next click does nothing
      onToggle={(event) => {
        if (event.currentTarget.open !== open) setOpen(event.currentTarget.open);
      }}
    >
      <summary
        onClick={(event) => {
          event.preventDefault();
          setOpen(!open);
        }}
      >
        {summary}
      </summary>
      <div className="drawer-body">{children}</div>
    </details>
  );
}
