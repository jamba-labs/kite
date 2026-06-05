import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeInputLatency } from "../src/metrics/latency.js";
import { parseTelemetry } from "../src/telemetry.js";
import { synthJumpRecording } from "./synth.js";

describe("input latency on synthetic telemetry", () => {
  it("measures zero latency when the game reacts on the edge frame", () => {
    const { recording } = synthJumpRecording({
      jumpVelocity: 260,
      gravityRise: 500,
      gravityFall: 500,
      pressFrames: [60],
      totalFrames: 180,
    });
    const m = computeInputLatency(recording, "player", "jump", 1);

    expect(m.samples).toHaveLength(1);
    expect(m.toStateFrames).toBe(0);
    expect(m.toMotionFrames).toBe(0);
  });

  it("recovers a configured response delay exactly", () => {
    const DELAY = 3;
    const { recording } = synthJumpRecording({
      jumpVelocity: 260,
      gravityRise: 500,
      gravityFall: 500,
      pressFrames: [60, 180],
      totalFrames: 300,
      responseDelayFrames: DELAY,
    });
    const m = computeInputLatency(recording, "player", "jump", 1);

    expect(m.samples).toHaveLength(2);
    expect(m.toStateFrames).toBe(DELAY);
    expect(m.toMotionFrames).toBe(DELAY);
  });
});

describe("input latency on a real fixture recording", () => {
  it("measures the engine's one-frame digital input lag", () => {
    const rec = parseTelemetry(
      readFileSync(join(__dirname, "fixtures", "jump_real.jsonl"), "utf8"),
    );
    const m = computeInputLatency(rec, "Player", "jump", 1);

    // MovementParams.INPUT_DELAY_FRAMES is 0; the 1 frame is the engine's
    // just_pressed stamping of injected digital input.
    expect(m.samples).toHaveLength(3);
    expect(m.toStateFrames).toBe(1);
    expect(m.toMotionFrames).toBe(1);
  });
});
