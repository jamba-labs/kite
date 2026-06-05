import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeJumpMetrics } from "../src/metrics/jump.js";
import { parseTelemetry } from "../src/telemetry.js";
import { synthJumpRecording } from "./synth.js";

describe("jump metrics on synthetic telemetry", () => {
  it("recovers apex time and height for a symmetric jump", () => {
    const V = 260;
    const G = 500;
    const { recording, trueApexHeightPx } = synthJumpRecording({
      jumpVelocity: V,
      gravityRise: G,
      gravityFall: G,
      pressFrames: [60],
      totalFrames: 240,
    });
    const m = computeJumpMetrics(recording, "player");

    expect(m.samples).toHaveLength(1);
    // interpolated zero crossing recovers the analytic apex time
    expect(m.apexTimeS!).toBeCloseTo(V / G, 4);
    // analyzer's height matches the simulation's true discrete apex
    expect(m.apexHeightPx!).toBeCloseTo(trueApexHeightPx, 2);
    // ...which sits within one velocity step above the continuous closed form
    const continuous = (V * V) / (2 * G);
    expect(m.apexHeightPx!).toBeGreaterThanOrEqual(continuous - 0.01);
    expect(m.apexHeightPx!).toBeLessThanOrEqual(continuous + V / 60 + 0.01);
    // symmetric gravity → symmetric arc
    expect(m.riseFallRatio!).toBeCloseTo(1.0, 1);
    // hang ≈ 2 * 0.1 * V / G for symmetric gravity
    expect(m.hangTimeS!).toBeCloseTo((2 * 0.1 * V) / G, 1);
  });

  it("recovers asymmetric gravity as rise:fall ratio", () => {
    const V = 260;
    const GR = 400;
    const GF = 900;
    const { recording } = synthJumpRecording({
      jumpVelocity: V,
      gravityRise: GR,
      gravityFall: GF,
      pressFrames: [60],
      totalFrames: 240,
    });
    const m = computeJumpMetrics(recording, "player");

    expect(m.samples).toHaveLength(1);
    expect(m.apexTimeS!).toBeCloseTo(V / GR, 4);
    // rise:fall = sqrt(GF/GR) for landing at takeoff height. Discretization
    // legitimately stretches the fall: the apex overshoots the continuous one
    // by ~V*dt/2 and landing quantizes up to a whole frame, so allow the
    // ratio error one frame of fall produces.
    const expected = Math.sqrt(GF / GR);
    const fallFrames = (V / Math.sqrt(GR * GF)) * 60;
    expect(Math.abs(m.riseFallRatio! - expected)).toBeLessThanOrEqual(
      (2 * expected) / fallFrames,
    );
  });

  it("collects one sample per jump and averages", () => {
    const V = 260;
    const G = 500;
    const { recording } = synthJumpRecording({
      jumpVelocity: V,
      gravityRise: G,
      gravityFall: G,
      pressFrames: [60, 180, 300],
      totalFrames: 420,
    });
    const m = computeJumpMetrics(recording, "player");

    expect(m.samples).toHaveLength(3);
    expect(m.apexTimeS!).toBeCloseTo(V / G, 4);
  });

  it("returns null means when nothing jumps", () => {
    const { recording } = synthJumpRecording({
      jumpVelocity: 260,
      gravityRise: 500,
      gravityFall: 500,
      pressFrames: [],
      totalFrames: 120,
    });
    const m = computeJumpMetrics(recording, "player");

    expect(m.samples).toHaveLength(0);
    expect(m.apexTimeS).toBeNull();
  });
});

describe("jump metrics on a real fixture recording", () => {
  // Recorded from the fixture game (MovementParams: V=260, G=500 symmetric).
  // The engine perceives an injected digital press one frame after the in-edge,
  // so apex time carries that frame on top of the analytic 0.52 s.
  const rec = parseTelemetry(
    readFileSync(join(__dirname, "fixtures", "jump_real.jsonl"), "utf8"),
  );

  it("measures all three jumps of jump_test", () => {
    const m = computeJumpMetrics(rec, "Player");

    expect(m.samples).toHaveLength(3);
    expect(m.apexTimeS!).toBeGreaterThanOrEqual(0.52);
    expect(m.apexTimeS!).toBeLessThanOrEqual(0.52 + 2 / 60);
    expect(m.apexHeightPx!).toBeGreaterThanOrEqual(67.6); // continuous floor
    expect(m.apexHeightPx!).toBeLessThanOrEqual(67.6 + 260 / 60); // + one step
    expect(m.riseFallRatio!).toBeCloseTo(1.0, 1);
    expect(m.hangTimeS!).toBeGreaterThanOrEqual(0.07);
    expect(m.hangTimeS!).toBeLessThanOrEqual(0.14);
  });
});

describe("telemetry parser", () => {
  it("skips unknown record kinds and keys", () => {
    const jsonl = [
      '{"k":"meta","kite_telemetry":"0.1","engine":"x","fixed_fps":60,"future_key":1}',
      '{"k":"someday","data":42}',
      '{"k":"frame","f":0,"t":0,"in":{},"e":{}}',
    ].join("\n");
    const rec = parseTelemetry(jsonl);

    expect(rec.frames).toHaveLength(1);
    expect(rec.meta.fixed_fps).toBe(60);
  });

  it("rejects telemetry without a meta line", () => {
    expect(() =>
      parseTelemetry('{"k":"frame","f":0,"t":0,"in":{},"e":{}}'),
    ).toThrow(/meta/);
  });
});
