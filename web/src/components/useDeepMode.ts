import { useCallback, useEffect, useState } from "react";

export function readDeep(search: string): boolean {
  return new URLSearchParams(search).get("deep") === "1";
}

export function withDeep(search: string, deep: boolean): string {
  const params = new URLSearchParams(search);
  if (deep) params.set("deep", "1");
  else params.delete("deep");
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function useDeepMode(): [boolean, (next: boolean) => void] {
  const [deep, setDeepState] = useState(() => readDeep(window.location.search));

  useEffect(() => {
    const onPop = () => setDeepState(readDeep(window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const setDeep = useCallback((next: boolean) => {
    const { pathname, search, hash } = window.location;
    window.history.replaceState(null, "", `${pathname}${withDeep(search, next)}${hash}`);
    setDeepState(next);
  }, []);

  return [deep, setDeep];
}
