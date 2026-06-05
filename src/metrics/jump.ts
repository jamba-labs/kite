// jump.* metrics (docs/metrics.md).
// Coordinate convention: y grows downward (Godot 2D), so rising means vy < 0.

import type { Recording, TelemetryFrame } from "../telemetry.js";

export interface JumpSample {
  /** frame number of the perceived jump-input edge */
  pressFrame: number;
  /** jump input → vy zero crossing (linearly interpolated), seconds */
  apexTimeS: number;
  /** max upward displacement from position at press, px */
  apexHeightPx: number;
  /** time rising (takeoff→apex) : time falling (apex→landing) */
  riseFallRatio: number;
  /** time where |vy| < 10% of peak |vy| during the flight, seconds */
  hangTimeS: number;
}

export interface JumpMetrics {
  samples: JumpSample[];
  /** means across samples; null when no complete jumps were detected */
  apexTimeS: number | null;
  apexHeightPx: number | null;
  riseFallRatio: number | null;
  hangTimeS: number | null;
}

const AIRBORNE_STATES = new Set(["jump", "fall"]);
/** how many frames after a press to look for takeoff before declaring a dud */
const TAKEOFF_SEARCH_FRAMES = 10;

export function computeJumpMetrics(
  rec: Recording,
  entityId: string,
  action = "jump",
): JumpMetrics {
  const frames = rec.frames;
  const samples: JumpSample[] = [];

  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1].in[action] ?? 0;
    const cur = frames[i].in[action] ?? 0;
    if (prev <= 0 && cur > 0) {
      const sample = measureJump(frames, i, entityId, rec.meta.fixed_fps);
      if (sample !== null) samples.push(sample);
    }
  }

  return {
    samples,
    apexTimeS: mean(samples.map((s) => s.apexTimeS)),
    apexHeightPx: mean(samples.map((s) => s.apexHeightPx)),
    riseFallRatio: mean(samples.map((s) => s.riseFallRatio)),
    hangTimeS: mean(samples.map((s) => s.hangTimeS)),
  };
}

function measureJump(
  frames: TelemetryFrame[],
  pressIdx: number,
  id: string,
  fps: number,
): JumpSample | null {
  const dt = 1 / fps;
  const press = frames[pressIdx];

  // Takeoff: first upward velocity at/after the press.
  let takeIdx = -1;
  const searchEnd = Math.min(pressIdx + TAKEOFF_SEARCH_FRAMES, frames.length);
  for (let j = pressIdx; j < searchEnd; j++) {
    const v = velY(frames[j], id);
    if (v !== undefined && v < 0) {
      takeIdx = j;
      break;
    }
  }
  if (takeIdx < 0) return null; // press produced no jump (e.g. buffered press ignored)

  // Takeoff position: the last grounded sample before upward motion (the
  // takeoff frame itself is already displaced by one velocity step).
  const y0 = posY(frames[Math.max(takeIdx - 1, 0)], id);
  if (y0 === undefined) return null;

  // Apex: vy zero crossing, linearly interpolated between samples. Velocity
  // is piecewise linear under constant gravity, so interpolation is exact.
  let apexF = -1;
  for (let j = takeIdx + 1; j < frames.length; j++) {
    const v0 = velY(frames[j - 1], id);
    const v1 = velY(frames[j], id);
    if (v0 === undefined || v1 === undefined) return null;
    if (v0 < 0 && v1 >= 0) {
      const frac = v1 === v0 ? 0 : -v0 / (v1 - v0);
      apexF = frames[j - 1].f + frac;
      break;
    }
  }
  if (apexF < 0) return null; // recording ended mid-rise

  // Landing: first grounded sample after the apex (state says grounded, or
  // velocity is exactly zeroed by floor collision).
  let landIdx = -1;
  let minY = Infinity;
  for (let j = takeIdx; j < frames.length; j++) {
    const yj = posY(frames[j], id);
    if (yj !== undefined && yj < minY) minY = yj;
    if (frames[j].f <= apexF) continue;
    const s = frames[j].e[id]?.s;
    const v = velY(frames[j], id);
    if ((s !== undefined && !AIRBORNE_STATES.has(s)) || v === 0) {
      landIdx = j;
      break;
    }
  }
  if (landIdx < 0) return null; // recording ended mid-fall

  // Hang time: frames in flight where |vy| < 10% of peak |vy|.
  let peak = 0;
  for (let j = takeIdx; j <= landIdx; j++) {
    peak = Math.max(peak, Math.abs(velY(frames[j], id) ?? 0));
  }
  const threshold = 0.1 * peak;
  let hangFrames = 0;
  for (let j = takeIdx; j <= landIdx; j++) {
    if (Math.abs(velY(frames[j], id) ?? 0) < threshold) hangFrames++;
  }

  const riseTime = (apexF - frames[takeIdx].f) * dt;
  const fallTime = (frames[landIdx].f - apexF) * dt;
  return {
    pressFrame: press.f,
    apexTimeS: (apexF - press.f) * dt,
    apexHeightPx: y0 - minY,
    riseFallRatio: fallTime > 0 ? riseTime / fallTime : Infinity,
    hangTimeS: hangFrames * dt,
  };
}

function posY(fr: TelemetryFrame, id: string): number | undefined {
  return fr.e[id]?.p?.[1];
}

function velY(fr: TelemetryFrame, id: string): number | undefined {
  return fr.e[id]?.v?.[1];
}

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
