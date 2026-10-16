import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { browserScheduler, type Scheduler } from "../../replay/useClock";

/** Speeds as multiples of the default pace; 0.01x on a 2x2 run is about one cycle per second. */
export const SPEEDS = [0.01, 0.05, 0.25, 1, 4, 16] as const;
export type PlaybackSpeed = (typeof SPEEDS)[number];
/** Seconds a whole run lasts at 1x. */
export const PACE_SECONDS = 20;

export interface CycleWindow {
  /** half open: cycles [from, to) are what the scene summarises this frame */
  from: number;
  to: number;
}

export interface Playback {
  /** cycles completed, 0 to total */
  cycle: number;
  playing: boolean;
  speed: PlaybackSpeed;
  atEnd: boolean;
  windowRef: MutableRefObject<CycleWindow>;
  play(): void;
  pause(): void;
  replay(): void;
  seek(cycle: number): void;
  step(delta: number): void;
  setSpeed(speed: PlaybackSpeed): void;
}

const lastCycle = (c: number): CycleWindow => ({ from: Math.max(0, c - 1), to: Math.max(1, c) });

export function usePlayback(total: number, scheduler: Scheduler = browserScheduler, initialCycle = 0): Playback {
  const start = Math.min(total, Math.max(0, initialCycle));
  const [cycle, setCycle] = useState(start);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState<PlaybackSpeed>(1);
  const position = useRef(start);
  const speedRef = useRef<PlaybackSpeed>(1);
  const windowRef = useRef<CycleWindow>(lastCycle(start));

  const place = useCallback(
    (to: number) => {
      const clamped = Math.min(total, Math.max(0, to));
      position.current = clamped;
      windowRef.current = lastCycle(Math.floor(clamped));
      setCycle(Math.floor(clamped));
    },
    [total],
  );

  useEffect(() => {
    if (!playing) return;
    const rate = total / PACE_SECONDS;
    let last = scheduler.now();
    let handle = 0;
    const frame = () => {
      const now = scheduler.now();
      const before = Math.floor(position.current);
      const next = Math.min(total, position.current + ((now - last) / 1000) * rate * speedRef.current);
      last = now;
      position.current = next;
      const after = Math.floor(next);
      if (after !== before) {
        windowRef.current = { from: before, to: after };
        setCycle(after);
      }
      if (next >= total) {
        setPlaying(false);
        return;
      }
      handle = scheduler.request(frame);
    };
    handle = scheduler.request(frame);
    return () => scheduler.cancel(handle);
  }, [playing, total, scheduler]);

  const play = useCallback(() => {
    if (total === 0) return;
    if (position.current >= total) place(0);
    setPlaying(true);
  }, [total, place]);
  const pause = useCallback(() => setPlaying(false), []);
  const replay = useCallback(() => {
    if (total === 0) return;
    place(0);
    setPlaying(true);
  }, [total, place]);
  const seek = useCallback(
    (to: number) => {
      setPlaying(false);
      place(to);
    },
    [place],
  );
  const step = useCallback(
    (delta: number) => {
      setPlaying(false);
      place(Math.floor(position.current) + delta);
    },
    [place],
  );
  const setSpeed = useCallback((next: PlaybackSpeed) => {
    speedRef.current = next;
    setSpeedState(next);
  }, []);

  return { cycle, playing, speed, atEnd: total > 0 && cycle >= total, windowRef, play, pause, replay, seek, step, setSpeed };
}
