// assist.* probes (docs/metrics.md): coyote and buffer windows measured
// empirically - generate input-script variants at increasing frame offsets,
// run each, and find the widest offset that still jumps. 0 means the assist
// does not exist; that's a value, not an error.
//
// The probe measures *behavior*, not config: if the engine's input plumbing
// eats a frame, the measured window is smaller than the configured constant -
// which is exactly the grace a real player experiences.

import type { Recording } from "./telemetry.js";

export interface InputEvent {
  f: number;
  a: string;
  v?: number;
}

/** runs a generated input script and returns its telemetry */
export type ProbeRunner = (events: InputEvent[], label: string) => Recording;

export interface AssistProbeResult {
  windowMs: number;
  /** frame the baseline run left the ground / landed */
  referenceFrame: number;
  offsetsTried: Array<{ offsetFrames: number; success: boolean }>;
}

const AIRBORNE_STATES = new Set(["jump", "fall"]);
const MAX_OFFSET_FRAMES = 20;
const PRESS_HOLD_FRAMES = 6;

export function probeCoyote(
  baseEvents: InputEvent[],
  run: ProbeRunner,
  entityId: string,
  fps: number,
  jumpAction = "jump",
): AssistProbeResult {
  const movement = baseEvents.filter((e) => e.a !== jumpAction && e.a !== "end");
  const endF = endFrame(baseEvents);

  const baseline = run([...movement, { f: endF, a: "end" }], "coyote-baseline");
  const leave = firstAirborneFrame(baseline, entityId);
  if (leave === null) {
    throw new Error("coyote probe: baseline run never leaves the ground - check the base test steers off a ledge");
  }

  const offsetsTried: AssistProbeResult["offsetsTried"] = [];
  let lastSuccess = -1;
  for (let k = 0; k <= MAX_OFFSET_FRAMES; k++) {
    const events = sortEvents([
      ...movement,
      { f: leave + k, a: jumpAction, v: 1 },
      { f: leave + k + PRESS_HOLD_FRAMES, a: jumpAction, v: 0 },
      { f: Math.max(endF, leave + k + 60), a: "end" },
    ]);
    const rec = run(events, `coyote+${k}`);
    const success = upwardMotionWithin(rec, entityId, leave + k, 8);
    offsetsTried.push({ offsetFrames: k, success });
    if (!success) break;
    lastSuccess = k;
  }

  return {
    // offset k succeeding means a press k frames after leaving ground still
    // jumps → the window spans k+1 frames of grace
    windowMs: lastSuccess < 0 ? 0 : round1(((lastSuccess + 1) * 1000) / fps),
    referenceFrame: leave,
    offsetsTried,
  };
}

export function probeBuffer(
  baseEvents: InputEvent[],
  run: ProbeRunner,
  entityId: string,
  fps: number,
  jumpAction = "jump",
): AssistProbeResult {
  // Baseline: keep only the FIRST press pair so the recording shows one jump
  // and a clean landing.
  const movement = baseEvents.filter((e) => e.a !== jumpAction && e.a !== "end");
  const presses = baseEvents.filter((e) => e.a === jumpAction);
  const firstPair = presses.slice(0, 2);
  if (firstPair.length < 2) {
    throw new Error("buffer probe: base test needs at least one jump press+release");
  }
  const endF = endFrame(baseEvents);

  const baseline = run(
    sortEvents([...movement, ...firstPair, { f: endF, a: "end" }]),
    "buffer-baseline",
  );
  const land = landingFrameAfter(baseline, entityId, firstPair[0].f);
  if (land === null) {
    throw new Error("buffer probe: baseline jump never lands within the recording");
  }

  const offsetsTried: AssistProbeResult["offsetsTried"] = [];
  let lastSuccess = 0;
  for (let k = 1; k <= MAX_OFFSET_FRAMES; k++) {
    const press = land - k;
    if (press <= firstPair[1].f + 2) break; // would collide with the first press
    const events = sortEvents([
      ...movement,
      ...firstPair,
      { f: press, a: jumpAction, v: 1 },
      { f: press + PRESS_HOLD_FRAMES, a: jumpAction, v: 0 },
      { f: Math.max(endF, land + 60), a: "end" },
    ]);
    const rec = run(events, `buffer-${k}`);
    const success = upwardMotionWithin(rec, entityId, land, 6);
    offsetsTried.push({ offsetFrames: k, success });
    if (!success) break;
    lastSuccess = k;
  }

  return {
    // a press on the landing frame (k≈1) is an ordinary grounded jump, not a
    // buffer - subtract that freebie
    windowMs: round1((Math.max(0, lastSuccess - 1) * 1000) / fps),
    referenceFrame: land,
    offsetsTried,
  };
}

// --- telemetry detectors -----------------------------------------------------

export function firstAirborneFrame(rec: Recording, id: string): number | null {
  let wasGrounded = false;
  for (const fr of rec.frames) {
    const s = fr.e[id]?.s;
    if (s === undefined) continue;
    if (!AIRBORNE_STATES.has(s)) {
      wasGrounded = true;
    } else if (wasGrounded) {
      return fr.f;
    }
  }
  return null;
}

export function landingFrameAfter(rec: Recording, id: string, after: number): number | null {
  let wasAirborne = false;
  for (const fr of rec.frames) {
    if (fr.f < after) continue;
    const s = fr.e[id]?.s;
    if (s === undefined) continue;
    if (AIRBORNE_STATES.has(s)) {
      wasAirborne = true;
    } else if (wasAirborne) {
      return fr.f;
    }
  }
  return null;
}

/** did upward motion (a jump) begin in [from, from+window]? */
export function upwardMotionWithin(
  rec: Recording,
  id: string,
  from: number,
  window: number,
): boolean {
  for (const fr of rec.frames) {
    if (fr.f < from || fr.f > from + window) continue;
    const vy = fr.e[id]?.v?.[1];
    if (vy !== undefined && vy < -1) return true;
  }
  return false;
}

// --- helpers -----------------------------------------------------------------

function endFrame(events: InputEvent[]): number {
  const end = events.find((e) => e.a === "end");
  if (!end) throw new Error("input script has no end event");
  return end.f;
}

function sortEvents(events: InputEvent[]): InputEvent[] {
  return [...events].sort((a, b) => a.f - b.f);
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
