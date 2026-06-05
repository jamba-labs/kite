// Assembles report.json (docs/report.md): every metric the pack could
// compute, plus contract evaluation when a contract is given.

import { evaluateContract, type ContractResult, type FeelContract } from "./contract.js";
import { computeInputLatency } from "./metrics/latency.js";
import { computeJumpMetrics } from "./metrics/jump.js";
import { computeRunMetrics } from "./metrics/run.js";
import type { Recording } from "./telemetry.js";
import type { MetricValue } from "./types.js";

export interface Report {
  kite_report: "0.1";
  test: string;
  telemetry: string;
  kite_metrics: "0.1";
  metrics: Record<string, MetricValue>;
  contract?: ContractResult;
  warnings: string[];
}

export interface BuildReportOptions {
  telemetryPath: string;
  contract?: FeelContract;
  contractSource?: string;
  /** entity to analyze; defaults to the first entity in the meta block */
  entityId?: string;
  /** additional metrics (e.g. cached assist probes) merged before contract evaluation */
  extraMetrics?: Record<string, MetricValue>;
}

export function buildReport(rec: Recording, opts: BuildReportOptions): Report {
  const entityId =
    opts.entityId ??
    Object.keys(rec.meta.entities ?? {})[0] ??
    Object.keys(rec.frames[0]?.e ?? {})[0];
  if (!entityId) throw new Error("telemetry has no entities to analyze");

  const metrics: Record<string, MetricValue> = {};
  const warnings: string[] = [];

  // input.* - measure over whichever scripted actions produced edges
  const latencySources = [
    { action: "jump", axis: 1 as const },
    { action: "move_x", axis: 0 as const },
  ];
  const stateSamples: number[] = [];
  const motionSamples: number[] = [];
  for (const src of latencySources) {
    const m = computeInputLatency(rec, entityId, src.action, src.axis);
    for (const s of m.samples) {
      if (s.toStateFrames !== null) stateSamples.push(s.toStateFrames);
      if (s.toMotionFrames !== null) motionSamples.push(s.toMotionFrames);
    }
  }
  if (stateSamples.length > 0) {
    metrics["input.latency_to_state_frames"] = scalar(mean(stateSamples), "frames", stateSamples);
  }
  if (motionSamples.length > 0) {
    metrics["input.latency_to_motion_frames"] = scalar(mean(motionSamples), "frames", motionSamples);
  }
  if (stateSamples.length === 0 && motionSamples.length === 0) {
    warnings.push("input.*: no input edges produced a measurable response");
  }

  // jump.*
  const jump = computeJumpMetrics(rec, entityId);
  if (jump.samples.length > 0) {
    metrics["jump.apex_time_s"] = scalar(jump.apexTimeS!, "s", jump.samples.map((s) => s.apexTimeS));
    metrics["jump.apex_height_px"] = scalar(jump.apexHeightPx!, "px", jump.samples.map((s) => s.apexHeightPx));
    metrics["jump.rise_fall_ratio"] = scalar(jump.riseFallRatio!, "ratio", jump.samples.map((s) => s.riseFallRatio));
    metrics["jump.hang_time_s"] = scalar(jump.hangTimeS!, "s", jump.samples.map((s) => s.hangTimeS));
  } else {
    warnings.push("jump.*: no complete jumps in this recording");
  }

  // run.*
  const run = computeRunMetrics(rec, entityId);
  if (run.maxSpeedPxS !== null) {
    metrics["run.max_speed_px_s"] = scalar(run.maxSpeedPxS, "px/s");
    if (run.accelTimeToMaxS !== null) {
      metrics["run.accel_time_to_max_s"] = scalar(run.accelTimeToMaxS, "s");
    }
    if (run.decelTimeToStopS !== null) {
      metrics["run.decel_time_to_stop_s"] = scalar(run.decelTimeToStopS, "s");
    }
    if (run.accelShape !== null) metrics["run.accel_shape"] = run.accelShape;
    if (run.decelShape !== null) metrics["run.decel_shape"] = run.decelShape;
  } else {
    warnings.push("run.*: no ground movement in this recording");
  }

  Object.assign(metrics, opts.extraMetrics);

  const report: Report = {
    kite_report: "0.1",
    test: rec.meta.test ?? "unknown",
    telemetry: opts.telemetryPath,
    kite_metrics: "0.1",
    metrics,
    warnings,
  };

  if (opts.contract) {
    const result = evaluateContract(opts.contract, metrics);
    result.source = opts.contractSource;
    report.contract = result;
    warnings.push(...result.warnings);
  }

  return report;
}

function scalar(value: number, unit: string, samples?: number[]): MetricValue {
  return {
    value: round4(value),
    unit,
    ...(samples && samples.length > 1 ? { samples: samples.map(round4) } : {}),
  };
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
