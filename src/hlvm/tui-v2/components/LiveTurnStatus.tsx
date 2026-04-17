import React from "react";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";
import type { Color } from "../ink/styles.ts";
import { useAnimationFrame } from "../ink/hooks/use-animation-frame.ts";
import { SpinnerGlyph } from "./Spinner/SpinnerGlyph.tsx";
import { GlimmerMessage } from "./Spinner/GlimmerMessage.tsx";
import { getSpinnerVerbs } from "../constants/spinnerVerbs.ts";
import { TURN_COMPLETION_VERBS } from "../constants/turnCompletionVerbs.ts";

const HLVM_BRAND_ORANGE: Color = "rgb(215,119,87)";
const HLVM_BRAND_SHIMMER: Color = "rgb(240,170,150)";
const ROLLUP_HOLD_MS = 2000;
const SHOW_ELAPSED_AFTER_SEC = 30;

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s}s`;
}

function pickRandom<T>(arr: readonly T[], fallback: T): T {
  if (arr.length === 0) return fallback;
  return arr[Math.floor(Math.random() * arr.length)] ?? fallback;
}

type Phase = "hidden" | "live" | "rollup";

type Props = {
  active: boolean;
};

export function LiveTurnStatus({ active }: Props): React.ReactNode {
  const [phase, setPhase] = React.useState<Phase>("hidden");
  const [liveVerb, setLiveVerb] = React.useState<string>("");
  const [rollupVerb, setRollupVerb] = React.useState<string>("");
  const [elapsedSec, setElapsedSec] = React.useState(0);
  const tickTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const rollupTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // `time` from the shared clock rotates the glyph and drives the shimmer
  // band reliably for visual animation, even though it is not dependable as
  // a wall-clock source in the compiled Deno build (see §13.F1-bug).
  const [, time] = useAnimationFrame(120);
  const frame = Math.floor(time / 120);

  React.useEffect(() => {
    if (active && phase !== "live") {
      setLiveVerb(pickRandom(getSpinnerVerbs(), "Working"));
      setElapsedSec(0);
      if (rollupTimerRef.current) {
        clearTimeout(rollupTimerRef.current);
        rollupTimerRef.current = null;
      }
      if (tickTimerRef.current) clearInterval(tickTimerRef.current);
      tickTimerRef.current = setInterval(() => {
        setElapsedSec((s) => s + 1);
      }, 1000);
      setPhase("live");
      return;
    }

    if (!active && phase === "live") {
      setRollupVerb(pickRandom(TURN_COMPLETION_VERBS, "Worked"));
      if (tickTimerRef.current) {
        clearInterval(tickTimerRef.current);
        tickTimerRef.current = null;
      }
      if (rollupTimerRef.current) clearTimeout(rollupTimerRef.current);
      rollupTimerRef.current = setTimeout(() => {
        setPhase("hidden");
      }, ROLLUP_HOLD_MS);
      setPhase("rollup");
    }
  }, [active, phase]);

  React.useEffect(() => {
    return () => {
      if (tickTimerRef.current) clearInterval(tickTimerRef.current);
      if (rollupTimerRef.current) clearTimeout(rollupTimerRef.current);
    };
  }, []);

  if (phase === "hidden") return null;

  const elapsedLabel = formatElapsed(elapsedSec * 1000);

  if (phase === "rollup") {
    return (
      <Box flexDirection="row" marginTop={1}>
        <Box width={2}>
          <Text color={HLVM_BRAND_ORANGE}>*</Text>
        </Box>
        <Text color={HLVM_BRAND_ORANGE}>
          {rollupVerb} for {elapsedLabel}
        </Text>
      </Box>
    );
  }

  const message = `${liveVerb}…`;
  // Shimmer animation disabled (glimmerIndex kept off-screen) until the
  // v2 ink screen-diff stops shuffling chars mid-sweep when sibling
  // Text spans change length. GlimmerMessage already handles the
  // off-screen case as a stable single-Text render.
  const glimmerIndex = -100;
  const showElapsed = elapsedSec >= SHOW_ELAPSED_AFTER_SEC;

  return (
    <Box flexDirection="row" marginTop={1} flexWrap="wrap" width="100%">
      <SpinnerGlyph
        frame={frame}
        messageColor={HLVM_BRAND_ORANGE}
        time={time}
      />
      <GlimmerMessage
        message={message}
        mode="thinking"
        messageColor={HLVM_BRAND_ORANGE}
        shimmerColor={HLVM_BRAND_SHIMMER}
        glimmerIndex={glimmerIndex}
        flashOpacity={0}
      />
      {showElapsed
        ? (
          <>
            <Text dimColor>(</Text>
            <Text dimColor>{elapsedLabel}</Text>
            <Text dimColor> · thinking)</Text>
          </>
        )
        : null}
    </Box>
  );
}
