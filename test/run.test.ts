import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeRunMetrics } from "../src/metrics/run.js";
import { parseTelemetry } from "../src/telemetry.js";
import { synthRunRecording } from "./synth.js";

const FPS = 60;
const DT = 1 / FPS;

describe("run metrics on synthetic telemetry", () => {
  it("recovers a linear envelope", () => {
    const rec = synthRunRecording({
      maxSpeed: 200,
      accelTime: 0.45,
      accelExponent: 1.0,
      decelTime: 0.4,
      decelExponent: 1.0,
      pressFrame: 30,
      releaseFrame: 240,
      totalFrames: 330,
    });
    const m = computeRunMetrics(rec, "player");

    expect(m.maxSpeedPxS!).toBeCloseTo(200, 3);
    // analytic time to 95% of max for k=1 is 0.95 * accelTime, ± one frame
    expect(Math.abs(m.accelTimeToMaxS! - 0.95 * 0.45)).toBeLessThanOrEqual(DT + 1e-9);
    expect(m.accelShape!.class).toBe("linear");
    expect(m.accelShape!.exponent).toBeCloseTo(1.0, 2);
    expect(m.accelShape!.r2).toBeGreaterThan(0.999);
    // analytic time to noise floor (30 px/s) for k=1: decelTime * (1 - 30/200)
    expect(Math.abs(m.decelTimeToStopS! - 0.4 * (1 - 30 / 200))).toBeLessThanOrEqual(
      1.5 * DT,
    );
    expect(m.decelShape!.class).toBe("linear");
    expect(m.decelShape!.exponent).toBeCloseTo(1.0, 2);
  });

  it("recovers accel ease exponents and classes", () => {
    for (const [exponent, cls] of [
      [0.5, "ease-out"],
      [2.0, "ease-in"],
    ] as const) {
      const rec = synthRunRecording({
        maxSpeed: 200,
        accelTime: 0.45,
        accelExponent: exponent,
        decelTime: 0.4,
        decelExponent: 1.0,
        pressFrame: 30,
        releaseFrame: 240,
        totalFrames: 330,
      });
      const m = computeRunMetrics(rec, "player");

      expect(m.accelShape!.exponent).toBeCloseTo(exponent, 1);
      expect(m.accelShape!.class).toBe(cls);
    }
  });

  it("recovers decel exponents with feel-inverted classes", () => {
    // Mirror exponent > 1 = fast initial slowdown = ease-out feel.
    for (const [exponent, cls] of [
      [2.5, "ease-out"],
      [0.5, "ease-in"],
    ] as const) {
      const rec = synthRunRecording({
        maxSpeed: 200,
        accelTime: 0.45,
        accelExponent: 1.0,
        decelTime: 0.4,
        decelExponent: exponent,
        pressFrame: 30,
        releaseFrame: 240,
        totalFrames: 330,
      });
      const m = computeRunMetrics(rec, "player");

      expect(m.decelShape!.exponent).toBeCloseTo(exponent, 1);
      expect(m.decelShape!.class).toBe(cls);
    }
  });

  it("returns nulls when nothing moves", () => {
    const rec = synthRunRecording({
      maxSpeed: 200,
      accelTime: 0.45,
      accelExponent: 1.0,
      decelTime: 0.4,
      decelExponent: 1.0,
      pressFrame: 500, // never pressed within the recording
      releaseFrame: 600,
      totalFrames: 120,
    });
    const m = computeRunMetrics(rec, "player");

    expect(m.maxSpeedPxS).toBeNull();
    expect(m.accelShape).toBeNull();
  });
});

describe("run metrics on a real fixture recording", () => {
  it("recovers MovementParams ground-truth values", () => {
    const rec = parseTelemetry(
      readFileSync(join(__dirname, "fixtures", "run_real.jsonl"), "utf8"),
    );
    const m = computeRunMetrics(rec, "Player");

    // MovementParams: MAX_SPEED=200, ACCEL_TIME=0.45 (linear), DECEL_TIME=0.4 (linear)
    expect(m.maxSpeedPxS!).toBeCloseTo(200, 1);
    expect(Math.abs(m.accelTimeToMaxS! - 0.95 * 0.45)).toBeLessThanOrEqual(1.5 * DT);
    expect(m.accelShape!.class).toBe("linear");
    expect(m.accelShape!.exponent).toBeCloseTo(1.0, 1);
    expect(m.accelShape!.r2).toBeGreaterThan(0.99);
    expect(Math.abs(m.decelTimeToStopS! - 0.4 * (1 - 30 / 200))).toBeLessThanOrEqual(
      1.5 * DT,
    );
    expect(m.decelShape!.class).toBe("linear");
    expect(m.decelShape!.exponent).toBeCloseTo(1.0, 1);
  });
});
