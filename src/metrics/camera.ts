// camera.* metrics (docs/metrics.md): screenshake envelope, measured from the
// camera's `offset` trace (the entity's `o` field). Offset is recorded instead
// of absolute position so the shake is isolated from camera-follow motion - a
// camera tracking the player still reports a clean shake signal.
//
// A shake "event" is a contiguous run where |offset| exceeds the onset floor
// (short sub-floor dips are bridged, since a per-frame-random direction can
// momentarily pass through zero). Amplitude is the peak |offset| of the event;
// decay is peak → the envelope falling under 10% of peak.

import type { Recording, TelemetryFrame } from "../telemetry.js";

export interface ShakeSample {
  /** frame of peak offset magnitude for this event */
  peakFrame: number;
  /** peak |offset| during the event, as a percentage of viewport height */
  amplitudePctVh: number;
  /** peak → envelope below 10% of peak, seconds */
  decayS: number;
}

export interface CameraMetrics {
  samples: ShakeSample[];
  /** mean peak amplitude (% of viewport height); 0 when the camera never shook */
  amplitudePctVh: number;
  /** mean decay across shake events; 0 when the camera never shook */
  decayS: number;
  /** true when an offset trace was present at all (a camera is instrumented) */
  present: boolean;
  /** false when the recording has no viewport size to normalize against */
  normalized: boolean;
}

/** |offset| above this (px) counts as shaking */
const ONSET_PX = 0.5;
/** envelope is "settled" below this fraction of the event peak */
const SETTLE_FRAC = 0.1;
/** consecutive sub-onset frames tolerated before an event is closed */
const GAP_FRAMES = 4;

/** first entity (other than excludeId) carrying an offset trace, or null */
export function findCameraEntity(rec: Recording, excludeId?: string): string | null {
  for (const fr of rec.frames) {
    for (const id of Object.keys(fr.e)) {
      if (id !== excludeId && fr.e[id]?.o !== undefined) return id;
    }
  }
  return null;
}

export function computeCameraMetrics(rec: Recording, entityId: string): CameraMetrics {
  const frames = rec.frames;
  const dt = 1 / rec.meta.fixed_fps;
  // Shake is reported relative to the project's coordinate space (% of viewport
  // height), so a contract means the same felt shake at any resolution.
  const vh = rec.meta.viewport?.[1] ?? 0;
  const toPctVh = vh > 0 ? 100 / vh : 0;
  const samples: ShakeSample[] = [];
  let present = false;

  let i = 0;
  while (i < frames.length) {
    const m = mag(frames[i], entityId);
    if (m === undefined) {
      i++;
      continue;
    }
    present = true;
    if (m <= ONSET_PX) {
      i++;
      continue;
    }

    // Walk the event, bridging short sub-onset gaps.
    let peak = 0;
    let peakF = frames[i].f;
    let lastActive = i;
    let gap = 0;
    let j = i;
    for (; j < frames.length; j++) {
      const mj = mag(frames[j], entityId);
      if (mj === undefined) break;
      if (mj > ONSET_PX) {
        gap = 0;
        lastActive = j;
        if (mj > peak) {
          peak = mj;
          peakF = frames[j].f;
        }
      } else if (++gap > GAP_FRAMES) {
        break;
      }
    }

    // Decay: peak → first sample at/after the peak below 10% of peak.
    let settleF = frames[lastActive].f + 1;
    for (let k = i; k <= lastActive; k++) {
      if (frames[k].f < peakF) continue;
      if ((mag(frames[k], entityId) ?? 0) < SETTLE_FRAC * peak) {
        settleF = frames[k].f;
        break;
      }
    }

    samples.push({ peakFrame: peakF, amplitudePctVh: peak * toPctVh, decayS: (settleF - peakF) * dt });
    i = lastActive + 1;
  }

  return {
    samples,
    amplitudePctVh: samples.length > 0 ? mean(samples.map((s) => s.amplitudePctVh)) : 0,
    decayS: samples.length > 0 ? mean(samples.map((s) => s.decayS)) : 0,
    present,
    normalized: toPctVh > 0,
  };
}

function mag(fr: TelemetryFrame, id: string): number | undefined {
  const o = fr.e[id]?.o;
  return o === undefined ? undefined : Math.hypot(o[0], o[1]);
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
