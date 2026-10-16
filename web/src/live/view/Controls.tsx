import { formatInt } from "../../format";
import { SPEEDS, type PlaybackSpeed } from "../playback/usePlayback";

export interface ControlsProps {
  playing: boolean;
  atEnd: boolean;
  speed: PlaybackSpeed;
  cycle: number;
  total: number;
  onToggle(): void;
  onReplay(): void;
  onStep(delta: number): void;
  onSeek(cycle: number): void;
  onSpeed(speed: PlaybackSpeed): void;
}

export function Controls({ playing, atEnd, speed, cycle, total, onToggle, onReplay, onStep, onSeek, onSpeed }: ControlsProps) {
  const text = `cycle ${formatInt(cycle)} of ${formatInt(total)}`;
  return (
    <div className="live-controls" role="group" aria-label="Playback controls">
      <button type="button" onClick={atEnd ? onReplay : onToggle}>
        {atEnd ? "Replay" : playing ? "Pause" : "Play"}
      </button>
      <button type="button" aria-label="Back one cycle" disabled={cycle <= 0} onClick={() => onStep(-1)}>
        -1
      </button>
      <button type="button" aria-label="Forward one cycle" disabled={cycle >= total} onClick={() => onStep(1)}>
        +1
      </button>
      <label className="live-scrub">
        <span className="live-scrub-label">{text}</span>
        <input
          type="range"
          min={0}
          max={total}
          value={cycle}
          aria-label="Cycle"
          aria-valuetext={text}
          onChange={(event) => onSeek(Number(event.target.value))}
        />
      </label>
      <div className="live-speed" role="group" aria-label="Speed">
        {SPEEDS.map((s) => (
          <button key={s} type="button" aria-pressed={s === speed} onClick={() => onSpeed(s)}>
            {s}x
          </button>
        ))}
      </div>
    </div>
  );
}
