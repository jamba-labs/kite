// input.* latency metrics (docs/metrics.md).
// Latency is measured from the perceived input edge (the frame the `in` value
// flips in telemetry) to the first observable response.

import type { Recording } from "../telemetry.js";

export interface LatencySample {
  pressFrame: number;
  /** frames until the entity's state-machine state changes; null if it never does */
  toStateFrames: number | null;
  /** frames until displacement on the relevant axis exceeds the noise floor */
  toMotionFrames: number | null;
}

export interface LatencyMetrics {
  samples: LatencySample[];
  /** means across samples; null when no edges produced a response */
  toStateFrames: number | null;
  toMotionFrames: number | null;
}

/** displacement below this is considered noise (docs/metrics.md) */
const NOISE_FLOOR_PX = 0.5;
/** frames after an edge to wait for a response before giving up */
const SEARCH_WINDOW_FRAMES = 30;

export function computeInputLatency(
  rec: Recording,
  entityId: string,
  action: string,
  /** position axis the action should move: 0 = x, 1 = y */
  axisIndex: 0 | 1,
): LatencyMetrics {
  const frames = rec.frames;
  const samples: LatencySample[] = [];

  for (let i = 1; i < frames.length; i++) {
    const prev = Math.abs(frames[i - 1].in[action] ?? 0);
    const cur = Math.abs(frames[i].in[action] ?? 0);
    if (!(prev === 0 && cur > 0)) continue;

    const baseState = frames[i - 1].e[entityId]?.s;
    const basePos = frames[i - 1].e[entityId]?.p?.[axisIndex];
    let toState: number | null = null;
    let toMotion: number | null = null;
    const end = Math.min(i + SEARCH_WINDOW_FRAMES, frames.length);
    for (let j = i; j < end; j++) {
      const ent = frames[j].e[entityId];
      if (toState === null && baseState !== undefined && ent?.s !== undefined && ent.s !== baseState) {
        toState = frames[j].f - frames[i].f;
      }
      if (
        toMotion === null &&
        basePos !== undefined &&
        ent?.p?.[axisIndex] !== undefined &&
        Math.abs(ent.p[axisIndex] - basePos) > NOISE_FLOOR_PX
      ) {
        toMotion = frames[j].f - frames[i].f;
      }
      if (toState !== null && toMotion !== null) break;
    }
    samples.push({ pressFrame: frames[i].f, toStateFrames: toState, toMotionFrames: toMotion });
  }

  return {
    samples,
    toStateFrames: mean(samples.map((s) => s.toStateFrames).filter(notNull)),
    toMotionFrames: mean(samples.map((s) => s.toMotionFrames).filter(notNull)),
  };
}

function notNull<T>(x: T | null): x is T {
  return x !== null;
}

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
