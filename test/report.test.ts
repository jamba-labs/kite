import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadContract } from "../src/contract.js";
import { buildReport } from "../src/report.js";
import { renderSummary } from "../src/summary.js";
import { parseTelemetry } from "../src/telemetry.js";

const jumpRec = () =>
  parseTelemetry(readFileSync(join(__dirname, "fixtures", "jump_real.jsonl"), "utf8"));

describe("report building on a real jump recording", () => {
  it("carries jump metrics, warns about absent run metrics", () => {
    const report = buildReport(jumpRec(), { telemetryPath: "runs/jump.jsonl" });

    expect(report.kite_report).toBe("0.1");
    expect(report.test).toBe("jump_test");
    expect(report.metrics["jump.apex_time_s"]).toBeDefined();
    expect(report.metrics["input.latency_to_motion_frames"]).toBeDefined();
    expect(report.metrics["run.max_speed_px_s"]).toBeUndefined();
    expect(report.warnings.join(" ")).toMatch(/run\.\*/);
    expect(report.contract).toBeUndefined();
  });

  it("evaluates the snappy contract against floaty defaults as FAIL", () => {
    const { contract, source } = loadContract("snappy", "presets");
    const report = buildReport(jumpRec(), {
      telemetryPath: "runs/jump.jsonl",
      contract,
      contractSource: source,
    });

    expect(report.contract).toBeDefined();
    expect(report.contract!.passed).toBe(false);
    const apex = report.contract!.rules.find((r) => r.metric === "jump.apex_time_s")!;
    // fixture defaults: apex ≈ 0.537 s vs snappy [0.30, 0.42]
    expect(apex.pass).toBe(false);
    expect(apex.hint).toMatch(/reduce/);
    // latency 1 frame ≤ max 3 passes
    const lat = report.contract!.rules.find(
      (r) => r.metric === "input.latency_to_motion_frames",
    )!;
    expect(lat.pass).toBe(true);
  });

  it("renders a summary with verdict, marks, and warnings", () => {
    const { contract, source } = loadContract("snappy", "presets");
    const report = buildReport(jumpRec(), {
      telemetryPath: "runs/jump.jsonl",
      contract,
      contractSource: source,
    });
    const text = renderSummary(report);

    expect(text).toMatch(/FAIL \(\d+\/\d+ rules\)/);
    expect(text).toContain("✓");
    expect(text).toContain("✗");
    expect(text).toContain("⚠");
    expect(text).toContain("telemetry: runs/jump.jsonl");
  });
});
