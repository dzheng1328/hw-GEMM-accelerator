import { useCallback, useEffect, useRef, useState } from "react";
import type { Speed } from "./types";

export interface Scheduler {
  now(): number;
  request(cb: () => void): number;
  cancel(handle: number): void;
}

export const browserScheduler: Scheduler = {
  now: () => performance.now(),
  request: (cb) => requestAnimationFrame(() => cb()),
  cancel: (handle) => cancelAnimationFrame(handle),
};

export interface ClockApi {
  /** Playback seconds at 1x. */
  elapsed: number;
  playing: boolean;
  speed: Speed;
  play(): void;
  pause(): void;
  toggle(): void;
  replay(): void;
  seek(seconds: number): void;
  setSpeed(speed: Speed): void;
}

export function useClock(totalSeconds: number, scheduler: Scheduler = browserScheduler): ClockApi {
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState<Speed>(1);
  const elapsedRef = useRef(0);
  const speedRef = useRef<Speed>(1);

  const move = useCallback((seconds: number) => {
    elapsedRef.current = seconds;
    setElapsed(seconds);
  }, []);

  useEffect(() => {
    if (!playing) return;
    let last = scheduler.now();
    let handle = 0;
    const frame = () => {
      const now = scheduler.now();
      const next = Math.min(totalSeconds, elapsedRef.current + ((now - last) / 1000) * speedRef.current);
      last = now;
      move(next);
      if (next >= totalSeconds) {
        setPlaying(false);
        return;
      }
      handle = scheduler.request(frame);
    };
    handle = scheduler.request(frame);
    return () => scheduler.cancel(handle);
  }, [playing, totalSeconds, scheduler, move]);

  const play = useCallback(() => {
    if (elapsedRef.current >= totalSeconds) move(0);
    setPlaying(true);
  }, [totalSeconds, move]);
  const pause = useCallback(() => setPlaying(false), []);
  const replay = useCallback(() => {
    move(0);
    setPlaying(true);
  }, [move]);
  const seek = useCallback(
    (seconds: number) => {
      setPlaying(false);
      move(Math.min(totalSeconds, Math.max(0, seconds)));
    },
    [totalSeconds, move],
  );
  const setSpeed = useCallback((next: Speed) => {
    speedRef.current = next;
    setSpeedState(next);
  }, []);
  const toggle = useCallback(() => {
    if (playing) pause();
    else play();
  }, [playing, play, pause]);

  return { elapsed, playing, speed, play, pause, toggle, replay, seek, setSpeed };
}
