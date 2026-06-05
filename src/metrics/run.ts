// run.* metrics (docs/metrics.md): max speed, time-to-max, time-to-stop, and
// curve shape via least-squares power-law fit of the velocity envelope.
//
// Timing convention: the engine applies the first envelope step during the
// frame the input edge is perceived, so a sample at edge frame f corresponds
// to envelope time (f - f_edge + 1) * dt.

import type { Recording } from "../telemetry.js";

export interface CurveShape {
  class: "linear" | "ease-in" | "ease-out";
  exponent: number;
  /** fit quality of the log-log regression; distrust shapes below ~0.8 */
  r2: number;
}

export interface RunMetrics {
  maxSpeedPxS: number | null;
  accelTimeToMaxS: number | null;
  decelTimeToStopS: number | null;
  accelShape: CurveShape | null;
  decelShape: CurveShape | null;
}

/** 0.5 px/frame displacement noise floor expressed as speed */
const noiseFloorSpeed = (fps: number): number => 0.5 * fps;
const LINEAR_BAND = 0.15; // |exponent - 1| within this reads as linear

export function computeRunMetrics(
  rec: Recording,
  entityId: string,
  action = "move_x",
): RunMetrics {
  const frames = rec.frames;
  const fps = rec.meta.fixed_fps;
  const dt = 1 / fps;

  // First hold segment: edge into nonzero, then back to zero.
  let aIdx = -1;
  let rIdx = -1;
  for (let i = 1; i < frames.length; i++) {
    const prev = Math.abs(frames[i - 1].in[action] ?? 0);
    const cur = Math.abs(frames[i].in[action] ?? 0);
    if (aIdx < 0 && prev === 0 && cur > 0) aIdx = i;
    else if (aIdx >= 0 && prev > 0 && cur === 0) {
      rIdx = i;
      break;
    }
  }
  if (aIdx < 0) {
    return { maxSpeedPxS: null, accelTimeToMaxS: null, decelTimeToStopS: null, accelShape: null, decelShape: null };
  }
  const holdEnd = rIdx > 0 ? rIdx : frames.length;

  // Max speed over the held segment.
  let maxSpeed = 0;
  for (let j = aIdx; j < holdEnd; j++) {
    maxSpeed = Math.max(maxSpeed, speed(frames, j, entityId));
  }
  if (maxSpeed === 0) {
    return { maxSpeedPxS: null, accelTimeToMaxS: null, decelTimeToStopS: null, accelShape: null, decelShape: null };
  }

  // Time to 95% of max, from the input edge.
  let accelTimeToMaxS: number | null = null;
  for (let j = aIdx; j < holdEnd; j++) {
    if (speed(frames, j, entityId) >= 0.95 * maxSpeed) {
      accelTimeToMaxS = (frames[j].f - frames[aIdx].f + 1) * dt;
      break;
    }
  }

  // Accel shape: fit pre-plateau samples to v ∝ t^k.
  const accelPts: Array<[number, number]> = [];
  for (let j = aIdx; j < holdEnd; j++) {
    const v = speed(frames, j, entityId);
    if (v > 0 && v < 0.999 * maxSpeed) {
      accelPts.push([(frames[j].f - frames[aIdx].f + 1) * dt, v]);
    } else if (v >= 0.999 * maxSpeed) {
      break;
    }
  }
  const accelShape = fitPowerLaw(accelPts);

  // Decel: from the release edge.
  let decelTimeToStopS: number | null = null;
  let decelShape: CurveShape | null = null;
  if (rIdx > 0) {
    const v0 = speed(frames, rIdx - 1, entityId);
    const floor = noiseFloorSpeed(fps);
    let stopIdx = -1;
    for (let j = rIdx; j < frames.length; j++) {
      if (speed(frames, j, entityId) < floor) {
        decelTimeToStopS = (frames[j].f - frames[rIdx].f) * dt;
        if (stopIdx < 0) stopIdx = j;
        break;
      }
    }
    // Full stop bounds the envelope for the shape fit. Prefer the exact zero
    // crossing - a 1%-of-v0 threshold truncates high-exponent envelopes whose
    // low-speed tail is long, which skews the whole fit. Fall back to the
    // threshold for asymptotic decels that never hit exact zero.
    let zeroIdx = -1;
    for (let j = rIdx; j < frames.length; j++) {
      if (speed(frames, j, entityId) < 1e-9) {
        zeroIdx = j;
        break;
      }
    }
    if (zeroIdx < 0) {
      for (let j = rIdx; j < frames.length; j++) {
        if (speed(frames, j, entityId) < 0.01 * v0) {
          zeroIdx = j;
          break;
        }
      }
    }
    if (zeroIdx > rIdx) {
      const total = (frames[zeroIdx].f - frames[rIdx].f + 1) * dt;
      const decelPts: Array<[number, number]> = [];
      for (let j = rIdx; j < zeroIdx; j++) {
        const tau = (frames[j].f - frames[rIdx].f + 1) * dt;
        const v = speed(frames, j, entityId);
        const remaining = 1 - tau / total; // mirror: v ∝ remaining^k
        if (v > 0 && remaining > 0) decelPts.push([remaining, v]);
      }
      // Decel classes invert: mirror exponent > 1 drops speed fastest at the
      // start, which is the ease-out feel (and vice versa).
      decelShape = fitPowerLaw(decelPts, true);
    }
  }

  return { maxSpeedPxS: maxSpeed, accelTimeToMaxS, decelTimeToStopS, accelShape, decelShape };
}

function speed(frames: Recording["frames"], idx: number, id: string): number {
  return Math.abs(frames[idx].e[id]?.v?.[0] ?? 0);
}

/** least-squares fit of ln(v) = k·ln(x) + c → {exponent k, r2} */
function fitPowerLaw(pts: Array<[number, number]>, invertClass = false): CurveShape | null {
  if (pts.length < 3) return null;
  const xs = pts.map(([x]) => Math.log(x));
  const ys = pts.map(([, y]) => Math.log(y));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  const k = sxy / sxx;
  const r2 = (sxy * sxy) / (sxx * syy);
  let cls: CurveShape["class"];
  if (Math.abs(k - 1) <= LINEAR_BAND) cls = "linear";
  else if (k > 1) cls = invertClass ? "ease-out" : "ease-in";
  else cls = invertClass ? "ease-in" : "ease-out";
  return { class: cls, exponent: round3(k), r2: round3(r2) };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
