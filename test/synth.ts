// Synthetic telemetry generator for analyzer tests (decision: expected
// answers come from math, never from blessed output). Simulates the same
// semi-implicit Euler integration the engine uses: vy += g*dt, then y += vy*dt,
// with no gravity applied on the takeoff frame (matching the fixture player,
// which skips gravity while grounded).

import type { Recording, TelemetryFrame } from "../src/telemetry.js";

export interface SynthJumpParams {
  fps?: number;
  jumpVelocity: number;
  gravityRise: number;
  gravityFall: number;
  /** frames at which a jump press edge occurs */
  pressFrames: number[];
  totalFrames: number;
  floorY?: number;
  /** frames a press is held before release */
  holdFrames?: number;
  /** frames between the in-edge and the game reacting (input latency) */
  responseDelayFrames?: number;
}

export interface SynthJumpResult {
  recording: Recording;
  /** true discrete apex height (floor minus min simulated y), px */
  trueApexHeightPx: number;
}

export function synthJumpRecording(p: SynthJumpParams): SynthJumpResult {
  const fps = p.fps ?? 60;
  const dt = 1 / fps;
  const floorY = p.floorY ?? 288;
  const holdFrames = p.holdFrames ?? 6;
  const delay = p.responseDelayFrames ?? 0;
  const presses = new Set(p.pressFrames);
  const reactions = new Set(p.pressFrames.map((f) => f + delay));

  let y = floorY;
  let vy = 0;
  let grounded = true;
  let minY = floorY;
  const frames: TelemetryFrame[] = [];

  for (let f = 0; f < p.totalFrames; f++) {
    // gravity (skipped while grounded, like the fixture player)
    if (!grounded) {
      vy += (vy < 0 ? p.gravityRise : p.gravityFall) * dt;
    }
    // takeoff overrides vy on the reaction frame, no gravity that frame
    if (reactions.has(f) && grounded) {
      vy = -p.jumpVelocity;
      grounded = false;
    }
    // integrate + land
    y += vy * dt;
    if (!grounded && y >= floorY) {
      y = floorY;
      vy = 0;
      grounded = true;
    }
    minY = Math.min(minY, y);

    const held = [...presses].some((pf) => f >= pf && f < pf + holdFrames);
    frames.push({
      k: "frame",
      f,
      t: f * dt,
      in: { jump: held ? 1 : 0 },
      e: {
        player: {
          p: [100, round3(y)],
          v: [0, round3(vy)],
          s: grounded ? "idle" : vy < 0 ? "jump" : "fall",
        },
      },
    });
  }

  return {
    recording: {
      meta: {
        k: "meta",
        kite_telemetry: "0.1",
        engine: "synthetic",
        fixed_fps: fps,
        viewport: [640, 360],
      },
      frames,
    },
    trueApexHeightPx: floorY - minY,
  };
}

export interface SynthRunParams {
  fps?: number;
  maxSpeed: number;
  accelTime: number;
  accelExponent: number;
  decelTime: number;
  decelExponent: number;
  pressFrame: number;
  releaseFrame: number;
  totalFrames: number;
}

/**
 * Ground-movement envelope matching the fixture player exactly:
 *   held:     v(t) = maxSpeed * (t/accelTime)^accelExponent
 *   released: v(τ) = v_release * (1 - τ/decelTime)^decelExponent
 * The first envelope step applies on the edge frame itself (axis inputs react
 * same-frame), so the sample at the edge frame carries envelope time dt.
 */
export function synthRunRecording(p: SynthRunParams): Recording {
  const fps = p.fps ?? 60;
  const dt = 1 / fps;

  let x = 100;
  let v = 0;
  let accelT = 0;
  let decelT = 0;
  let vRelease = 0;
  const frames: TelemetryFrame[] = [];

  for (let f = 0; f < p.totalFrames; f++) {
    const held = f >= p.pressFrame && f < p.releaseFrame;
    if (held) {
      accelT += dt;
      v = p.maxSpeed * Math.min(accelT / p.accelTime, 1) ** p.accelExponent;
      decelT = 0;
      vRelease = v;
    } else if (f >= p.releaseFrame && v > 0) {
      decelT += dt;
      v = vRelease * Math.max(1 - decelT / p.decelTime, 0) ** p.decelExponent;
    }
    x += v * dt;
    frames.push({
      k: "frame",
      f,
      t: f * dt,
      in: { move_x: held ? 1 : 0 },
      e: {
        player: {
          p: [round3(x), 288],
          v: [round3(v), 0],
          s: v > 0 ? "run" : "idle",
        },
      },
    });
  }

  return {
    meta: { k: "meta", kite_telemetry: "0.1", engine: "synthetic", fixed_fps: fps, viewport: [640, 360] },
    frames,
  };
}

export interface SynthShakeParams {
  fps?: number;
  /** peak camera offset on landing, px */
  amplitudePx: number;
  /** time for trauma to fall 1 → 0, seconds */
  durationS: number;
  /** frames at which a landing (shake onset) occurs */
  landFrames: number[];
  totalFrames: number;
}

/**
 * Camera offset envelope matching the fixture's screenshake exactly:
 *   |offset(t)| = amplitudePx * trauma,  trauma = max(1 - t/durationS, 0)
 * Direction alternates each frame so the trace reads as shake while the
 * magnitude stays a clean, math-checkable envelope. Expected metrics:
 *   amplitude ≈ amplitudePx        (peak at the landing frame, trauma = 1)
 *   decay     ≈ 0.9 * durationS    (trauma < 0.1 ⇒ envelope below 10% of peak)
 */
export function synthShakeRecording(p: SynthShakeParams): Recording {
  const fps = p.fps ?? 60;
  const dt = 1 / fps;
  const frames: TelemetryFrame[] = [];

  for (let f = 0; f < p.totalFrames; f++) {
    let trauma = 0;
    for (const land of p.landFrames) {
      if (f >= land) trauma = Math.max(trauma, Math.max(1 - ((f - land) * dt) / p.durationS, 0));
    }
    const ox = p.amplitudePx * trauma * (f % 2 === 0 ? 1 : -1);
    frames.push({
      k: "frame",
      f,
      t: f * dt,
      in: {},
      e: {
        player: { p: [100, 288], v: [0, 0] },
        Camera2D: { p: [100, 288], o: [round3(ox), 0] },
      },
    });
  }

  return {
    meta: { k: "meta", kite_telemetry: "0.1", engine: "synthetic", fixed_fps: fps, viewport: [640, 360] },
    frames,
  };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
