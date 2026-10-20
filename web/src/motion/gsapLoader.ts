export type Gsap = typeof import("gsap").gsap;

let cached: Promise<Gsap> | null = null;

/** GSAP and ScrollTrigger are one lazy chunk. A failed load is not remembered, so a later mount can try again. */
export function loadGsap(): Promise<Gsap> {
  const loading = (cached ??= Promise.all([import("gsap"), import("gsap/ScrollTrigger")]).then(([{ gsap }, { ScrollTrigger }]) => {
    gsap.registerPlugin(ScrollTrigger);
    return gsap;
  }));
  loading.catch(() => {
    if (cached === loading) cached = null;
  });
  return loading;
}
