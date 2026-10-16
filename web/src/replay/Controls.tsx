import { SPEEDS, type Speed } from "./types";

export interface ControlsProps {
  playing: boolean;
  atEnd: boolean;
  speed: Speed;
  step: number;
  lastStep: number;
  onToggle(): void;
  onReplay(): void;
  onSpeed(speed: Speed): void;
  onSeek(step: number): void;
}

export function Controls({ playing, atEnd, speed, step, lastStep, onToggle, onReplay, onSpeed, onSeek }: ControlsProps) {
  return (
    <div className="controls" role="group" aria-label="Replay controls">
      <button type="button" onClick={atEnd ? onReplay : onToggle}>
        {atEnd ? "Replay" : playing ? "Pause" : "Play"}
      </button>
      <label className="scrub">
        <span className="scrub-label">
          Step {step} of {lastStep}
        </span>
        <input
          type="range"
          min={0}
          max={lastStep}
          value={step}
          aria-label="Step"
          onChange={(event) => onSeek(Number(event.target.value))}
        />
      </label>
      <div className="speed" role="group" aria-label="Speed">
        {SPEEDS.map((s) => (
          <button key={s} type="button" aria-pressed={s === speed} onClick={() => onSpeed(s)}>
            {s}x
          </button>
        ))}
      </div>
    </div>
  );
}
