import { useEffect, useMemo, useRef, useState } from "react";
import { Section } from "../components/Section";
import summary from "../data/generated/summary.json";
import { formatInt } from "../format";
import { AttentionSparkline } from "./AttentionSparkline";
import { AttentionView } from "./AttentionView";
import { attentionShareSeries } from "./categories";
import { Controls } from "./Controls";
import { CycleBar } from "./CycleBar";
import { useInView, useLazyData, usePrefersReducedMotion } from "./hooks";
import { Lane } from "./Lane";
import { loadReplayData } from "./loadReplayData";
import { buildTimeline, cyclesAt, stepAt } from "./timeline";
import { laneAt } from "./tokens";
import type { ReplayData, Speed } from "./types";
import { browserScheduler, useClock, type Scheduler } from "./useClock";

export const TOTAL_SECONDS = 25;

export interface ReplaySectionProps {
  scheduler?: Scheduler;
  loadData?: () => Promise<ReplayData>;
}

export function ReplaySection({ scheduler = browserScheduler, loadData = loadReplayData }: ReplaySectionProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const near = useInView(stageRef, "100% 0px");
  const entered = useInView(stageRef, "0px 0px -15% 0px");
  const reduced = usePrefersReducedMotion();
  const { status, data } = useLazyData(loadData, near);
  const clock = useClock(TOTAL_SECONDS, scheduler);
  const { seek, replay } = clock;
  const [announcement, setAnnouncement] = useState("");

  const timeline = useMemo(
    () => (data ? buildTimeline(data.steps.map((s) => s.cycles), TOTAL_SECONDS) : null),
    [data],
  );
  const step = timeline ? stepAt(timeline, clock.elapsed) : 0;
  const cycles = timeline ? cyclesAt(timeline, clock.elapsed) : 0;
  const lanes = useMemo(
    () => (data ? data.stories.map((story) => laneAt(story, data.vocab, data.promptLength, step)) : []),
    [data, step],
  );
  const series = useMemo(() => (data ? attentionShareSeries(data.steps) : []), [data]);

  const autoplayed = useRef(false);
  useEffect(() => {
    if (!data || !entered || autoplayed.current) return;
    autoplayed.current = true;
    if (reduced) seek(TOTAL_SECONDS);
    else replay();
  }, [data, entered, reduced, seek, replay]);

  const lastStep = data ? data.steps.length - 1 : 0;
  const atEnd = clock.elapsed >= TOTAL_SECONDS;
  const runCycles = summary.lm.meshes["2x2_t256"]!.cycles;
  const tail = timeline ? runCycles - timeline.totalCycles : 0;

  const onToggle = () => {
    if (clock.playing) {
      clock.pause();
      setAnnouncement(`Paused at step ${step}`);
    } else {
      clock.play();
      setAnnouncement("Playing");
    }
  };
  const onReplay = () => {
    clock.replay();
    setAnnouncement("Replaying from step 0");
  };
  const onSpeed = (speed: Speed) => {
    clock.setSpeed(speed);
    setAnnouncement(`Speed ${speed}x`);
  };
  const onSeek = (target: number) => {
    if (timeline) clock.seek(timeline.start[target] ?? 0);
  };

  return (
    <Section
      id="replay"
      title="Watch it think"
      headline="Eight stories decoded in parallel, one per lane, replayed from the recorded RTL run."
      drawer={{
        summary: "Go deeper",
        body:
          status === "ready" && data ? (
            <AttentionView data={data} step={step} />
          ) : (
            <p className="placeholder">The attention view loads with the replay.</p>
          ),
      }}
    >
      <div ref={stageRef} className="replay-stage">
        <p className="replay-note">
          A replay of one recorded RTL simulation (2x2 mesh, temperature 1.0), bit-exact against the integer reference.
          Nothing here is computed in your browser.
        </p>
        {status === "error" ? (
          <p className="replay-error" role="alert">
            The recorded run could not be loaded. The rest of the page still works; reload to try again.
          </p>
        ) : null}
        {status === "idle" || status === "loading" ? <p className="replay-loading">Loading the recorded run...</p> : null}
        {status === "ready" && data && timeline ? (
          <>
            <Controls
              playing={clock.playing}
              atEnd={atEnd}
              speed={clock.speed}
              step={step}
              lastStep={lastStep}
              onToggle={onToggle}
              onReplay={onReplay}
              onSpeed={onSpeed}
              onSeek={onSeek}
            />
            <p className="cycle-counter">
              <span className="counter-value">{formatInt(cycles)}</span> <small>cycles</small>
            </p>
            {tail > 0 ? (
              <p className="counter-note">
                The run's total is {formatInt(runCycles)}: the last {formatInt(tail)} cycles come after the final token.
              </p>
            ) : null}
            <CycleBar step={data.steps[step]!} />
            <AttentionSparkline series={series} step={step} />
            <div className="lanes">
              {lanes.map((lane, i) => (
                <Lane key={i} index={i} lane={lane} />
              ))}
            </div>
          </>
        ) : null}
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
      </div>
    </Section>
  );
}
