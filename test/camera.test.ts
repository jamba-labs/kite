import { describe, expect, it } from "vitest";
import { loadContract } from "../src/contract.js";
import { computeCameraMetrics, findCameraEntity } from "../src/metrics/camera.js";
import { buildReport } from "../src/report.js";
import type { ScalarValue } from "../src/types.js";
import { synthJumpRecording, synthShakeRecording } from "./synth.js";

const dt = 1 / 60;

describe("camera shake metrics on synthetic telemetry", () => {
  it("recovers peak amplitude and decay for one landing", () => {
    const AMP = 10;
    const DUR = 0.25;
    const rec = synthShakeRecording({
      amplitudePx: AMP,
      durationS: DUR,
      landFrames: [30],
      totalFrames: 120,
    });
    const m = computeCameraMetrics(rec, "Camera2D");

    expect(m.present).toBe(true);
    expect(m.samples).toHaveLength(1);
    // peak is at the landing frame where trauma = 1, so |offset| = AMP exactly
    expect(m.amplitudePx).toBeCloseTo(AMP, 5);
    // envelope drops below 10% of peak when trauma < 0.1, i.e. t > 0.9*DUR;
    // frame quantization can carry that up to one frame past the closed form
    expect(m.decayS).toBeGreaterThanOrEqual(0.9 * DUR - 1e-9);
    expect(m.decayS).toBeLessThanOrEqual(0.9 * DUR + 1.5 * dt);
  });

  it("collects one sample per landing and averages", () => {
    const rec = synthShakeRecording({
      amplitudePx: 8,
      durationS: 0.25,
      landFrames: [30, 150],
      totalFrames: 300,
    });
    const m = computeCameraMetrics(rec, "Camera2D");

    expect(m.samples).toHaveLength(2);
    expect(m.amplitudePx).toBeCloseTo(8, 5);
  });

  it("reports zero shake (but present) when the camera never moves", () => {
    const rec = synthShakeRecording({
      amplitudePx: 0,
      durationS: 0.25,
      landFrames: [30],
      totalFrames: 120,
    });
    const m = computeCameraMetrics(rec, "Camera2D");

    expect(m.present).toBe(true);
    expect(m.samples).toHaveLength(0);
    expect(m.amplitudePx).toBe(0);
    expect(m.decayS).toBe(0);
  });

  it("finds the camera entity by its offset trace, and only that", () => {
    const shaken = synthShakeRecording({
      amplitudePx: 10,
      durationS: 0.25,
      landFrames: [30],
      totalFrames: 120,
    });
    expect(findCameraEntity(shaken, "player")).toBe("Camera2D");

    // a recording with no offset trace has no camera entity
    const { recording: jump } = synthJumpRecording({
      jumpVelocity: 260,
      gravityRise: 500,
      gravityFall: 500,
      pressFrames: [60],
      totalFrames: 180,
    });
    expect(findCameraEntity(jump)).toBeNull();
  });
});

describe("camera metrics in the report and the arcade contract", () => {
  it("emits camera.* only when a camera is instrumented", () => {
    const { recording: jump } = synthJumpRecording({
      jumpVelocity: 260,
      gravityRise: 500,
      gravityFall: 500,
      pressFrames: [60],
      totalFrames: 180,
    });
    const noCam = buildReport(jump, { telemetryPath: "runs/x.jsonl" });
    expect(noCam.metrics["camera.shake_amplitude_px"]).toBeUndefined();

    const shaken = synthShakeRecording({
      amplitudePx: 10,
      durationS: 0.25,
      landFrames: [30],
      totalFrames: 120,
    });
    const withCam = buildReport(shaken, { telemetryPath: "runs/y.jsonl" });
    expect((withCam.metrics["camera.shake_amplitude_px"] as ScalarValue).value).toBeCloseTo(10, 4);
  });

  it("analyzes the character, not a camera listed first in the group", () => {
    // Regression: when the camera sorts before the player in the track group,
    // the movement metrics must still target the velocity-bearing entity.
    const { recording } = synthJumpRecording({
      jumpVelocity: 260,
      gravityRise: 500,
      gravityFall: 500,
      pressFrames: [60],
      totalFrames: 180,
    });
    // Reorder so the camera (offset-only, no velocity) is the first entity.
    const reordered: typeof recording = {
      meta: { ...recording.meta, entities: { Camera2D: "Camera2D", player: "Player" } },
      frames: recording.frames.map((f) => ({
        ...f,
        e: { Camera2D: { o: [0, 0] as [number, number] }, ...f.e },
      })),
    };
    const report = buildReport(reordered, { telemetryPath: "runs/z.jsonl" });
    expect(report.metrics["jump.apex_time_s"]).toBeDefined();
    expect(report.metrics["camera.shake_amplitude_px"]).toBeDefined();
  });

  it("fails the arcade shake rule flat, passes it once shaking", () => {
    const { contract, source } = loadContract("arcade", "presets");

    const flat = buildReport(
      synthShakeRecording({ amplitudePx: 0, durationS: 0.25, landFrames: [30], totalFrames: 120 }),
      { telemetryPath: "runs/flat.jsonl", contract, contractSource: source },
    );
    const flatRule = flat.contract!.rules.find((r) => r.metric === "camera.shake_amplitude_px")!;
    expect(flatRule.pass).toBe(false);
    expect(flatRule.hint).toMatch(/increase/);

    const juicy = buildReport(
      synthShakeRecording({ amplitudePx: 10, durationS: 0.25, landFrames: [30], totalFrames: 120 }),
      { telemetryPath: "runs/juicy.jsonl", contract, contractSource: source },
    );
    const ampRule = juicy.contract!.rules.find((r) => r.metric === "camera.shake_amplitude_px")!;
    const decayRule = juicy.contract!.rules.find((r) => r.metric === "camera.shake_decay_s")!;
    expect(ampRule.pass).toBe(true);
    expect(decayRule.pass).toBe(true);
  });
});
