import { describe, expect, it } from "vitest";
import {
  probeBuffer,
  probeCoyote,
  type InputEvent,
  type ProbeRunner,
} from "../src/probe.js";
import type { Recording, TelemetryFrame } from "../src/telemetry.js";

// Mock world: player runs, leaves the ground at LEAVE, falls, lands at LAND.
// A jump press injected at frame P succeeds when the simulated window allows
// it; success shows up as upward velocity right after P (coyote) or right
// after landing (buffer).

const LEAVE = 100;
const LAND = 160;
const FPS = 60;

function world(frames: Array<Partial<TelemetryFrame> & { f: number }>): Recording {
  return {
    meta: { k: "meta", kite_telemetry: "0.1", engine: "synthetic", fixed_fps: FPS },
    frames: frames.map((p) => ({
      k: "frame" as const,
      t: p.f / FPS,
      in: {},
      e: {},
      ...p,
    })),
  };
}

function ent(s: string, vy = 0): TelemetryFrame["e"] {
  return { player: { p: [0, 0], v: [0, vy], s } };
}

/** coyote world: press within `windowFrames` after LEAVE → jump succeeds */
function coyoteRunner(windowFrames: number): ProbeRunner {
  return (events: InputEvent[]) => {
    const press = events.find((e) => e.a === "jump" && (e.v ?? 0) > 0)?.f;
    const succeeds = press !== undefined && press >= LEAVE && press - LEAVE < windowFrames;
    const frames = [];
    for (let f = 0; f <= 260; f++) {
      if (f < LEAVE) frames.push({ f, e: ent("run") });
      else if (succeeds && press !== undefined && f > press && f <= press + 5)
        frames.push({ f, e: ent("jump", -200) });
      else frames.push({ f, e: ent("fall", 100) });
    }
    return world(frames);
  };
}

/** buffer world: second press within `windowFrames` before LAND → re-jump on landing */
function bufferRunner(windowFrames: number): ProbeRunner {
  return (events: InputEvent[]) => {
    const presses = events.filter((e) => e.a === "jump" && (e.v ?? 0) > 0).map((e) => e.f);
    const second = presses[1];
    // a press at/after landing is an ordinary grounded jump (the freebie);
    // earlier presses only fire if buffered
    const succeeds =
      second !== undefined && (second >= LAND - 1 || LAND - second <= windowFrames);
    const frames = [];
    for (let f = 0; f <= 260; f++) {
      if (f < 60) frames.push({ f, e: ent("idle") });
      else if (f < 90) frames.push({ f, e: ent("jump", -200) });
      else if (f < LAND) frames.push({ f, e: ent("fall", 150) });
      else if (succeeds && f >= LAND && f <= LAND + 5) frames.push({ f, e: ent("jump", -200) });
      else frames.push({ f, e: ent("idle") });
    }
    return world(frames);
  };
}

const COYOTE_BASE: InputEvent[] = [
  { f: 10, a: "move_x", v: 1 },
  { f: 270, a: "jump", v: 1 },
  { f: 276, a: "jump", v: 0 },
  { f: 360, a: "end" },
];

const BUFFER_BASE: InputEvent[] = [
  { f: 60, a: "jump", v: 1 },
  { f: 66, a: "jump", v: 0 },
  { f: 110, a: "jump", v: 1 },
  { f: 116, a: "jump", v: 0 },
  { f: 240, a: "end" },
];

describe("coyote probe", () => {
  it("reports 0 when the assist does not exist", () => {
    const r = probeCoyote(COYOTE_BASE, coyoteRunner(0), "player", FPS);

    expect(r.windowMs).toBe(0);
    expect(r.referenceFrame).toBe(LEAVE);
    expect(r.offsetsTried).toEqual([{ offsetFrames: 0, success: false }]);
  });

  it("finds a 5-frame window as ~83ms", () => {
    const r = probeCoyote(COYOTE_BASE, coyoteRunner(5), "player", FPS);

    // offsets 0..4 succeed, 5 fails → window = 5 frames = 83.3 ms
    expect(r.windowMs).toBeCloseTo((5 * 1000) / FPS, 0);
    expect(r.offsetsTried).toHaveLength(6);
    expect(r.offsetsTried[4].success).toBe(true);
    expect(r.offsetsTried[5].success).toBe(false);
  });
});

describe("buffer probe", () => {
  it("reports 0 when only the landing-frame freebie works", () => {
    const r = probeBuffer(BUFFER_BASE, bufferRunner(0), "player", FPS);

    expect(r.windowMs).toBe(0);
    expect(r.referenceFrame).toBe(LAND);
  });

  it("finds a 6-frame buffer as ~83ms after the freebie", () => {
    const r = probeBuffer(BUFFER_BASE, bufferRunner(6), "player", FPS);

    // k=1..6 succeed, 7 fails → (6-1) frames = 83.3 ms
    expect(r.windowMs).toBeCloseTo((5 * 1000) / FPS, 0);
  });
});
