import { describe, expect, it } from "vitest";
import { evaluateContract, loadContract, type FeelContract } from "../src/contract.js";
import type { MetricValue } from "../src/types.js";

const contract = (rules: FeelContract["rules"]): FeelContract => ({
  kite_contract: "0.1",
  name: "test",
  rules,
});

describe("contract evaluation", () => {
  it("passes and fails scalar bounds with normalized deltas", () => {
    const metrics: Record<string, MetricValue> = {
      "a.in_range": { value: 0.35, unit: "s" },
      "a.over_max": { value: 0.48, unit: "s" },
      "a.under_min": { value: 0.2, unit: "s" },
    };
    const result = evaluateContract(
      contract({
        "a.in_range": { range: [0.3, 0.42] },
        "a.over_max": { range: [0.3, 0.42] },
        "a.under_min": { min: 0.25 },
      }),
      metrics,
    );

    expect(result.passed).toBe(false);
    const byMetric = Object.fromEntries(result.rules.map((r) => [r.metric, r]));
    expect(byMetric["a.in_range"].pass).toBe(true);
    expect(byMetric["a.in_range"].delta).toBe(0);
    // (0.48 - 0.42) / 0.42 ≈ 0.143 - delta normalized by the violated bound
    expect(byMetric["a.over_max"].pass).toBe(false);
    expect(byMetric["a.over_max"].delta).toBeCloseTo(0.143, 2);
    expect(byMetric["a.over_max"].hint).toMatch(/reduce by ~0.060 s/);
    expect(byMetric["a.under_min"].hint).toMatch(/increase/);
  });

  it("evaluates shape rules on class and exponent bounds", () => {
    const metrics: Record<string, MetricValue> = {
      "s.right": { class: "ease-out", exponent: 2.4, r2: 0.99 },
      "s.wrong_class": { class: "linear", exponent: 1.02, r2: 0.99 },
      "s.low_exponent": { class: "ease-out", exponent: 1.5, r2: 0.99 },
    };
    const result = evaluateContract(
      contract({
        "s.right": { shape: "ease-out", exponent_min: 2.0 },
        "s.wrong_class": { shape: "ease-out", exponent_min: 2.0 },
        "s.low_exponent": { shape: "ease-out", exponent_min: 2.0 },
      }),
      metrics,
    );

    const byMetric = Object.fromEntries(result.rules.map((r) => [r.metric, r]));
    expect(byMetric["s.right"].pass).toBe(true);
    expect(byMetric["s.wrong_class"].pass).toBe(false);
    expect(byMetric["s.wrong_class"].delta).toBeCloseTo((2.0 - 1.02) / 2.0, 2);
    expect(byMetric["s.wrong_class"].hint).toMatch(/wants ease-out/);
    expect(byMetric["s.low_exponent"].pass).toBe(false);
  });

  it("skips low-confidence shapes and missing metrics as warnings", () => {
    const metrics: Record<string, MetricValue> = {
      "s.noisy": { class: "ease-out", exponent: 2.4, r2: 0.5 },
    };
    const result = evaluateContract(
      contract({
        "s.noisy": { shape: "ease-out" },
        "m.absent": { max: 3 },
      }),
      metrics,
    );

    expect(result.rules).toHaveLength(0);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.join(" ")).toMatch(/r2=0.5/);
    expect(result.warnings.join(" ")).toMatch(/not present/);
    // nothing was actually checked → cannot claim a pass
    expect(result.passed).toBe(false);
  });

  it("loads presets by name and merges extends child-wins", () => {
    const { contract: snappy, source } = loadContract("snappy", "presets");
    expect(source).toMatch(/snappy\.json$/);
    expect(snappy.rules["jump.apex_time_s"]).toEqual({ range: [0.3, 0.42] });

    const { contract: derived } = loadContract(
      "test/fixtures/contracts/custom.json",
      "presets",
    );
    // inherited from snappy
    expect(derived.rules["run.decel_shape"]).toEqual({ shape: "ease-out", exponent_min: 2.0 });
    // overridden by the child
    expect(derived.rules["jump.apex_time_s"]).toEqual({ range: [0.2, 0.3] });
  });
});
