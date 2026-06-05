# Report format (draft)

`kite run <test>` emits two artifacts: `report.json` (for agents) and a terminal summary
(for humans). The JSON is the source of truth; the summary is rendered from it.

## `report.json`

```jsonc
{
  "kite_report": "0.1",
  "test": "jump_test",
  "telemetry": "runs/jump_test/2026-06-05T21-00-00.jsonl",
  "kite_metrics": "0.1",
  "metrics": {
    "input.latency_to_motion_frames": { "value": 2, "unit": "frames" },
    "jump.apex_time_s": { "value": 0.48, "unit": "s",
                          "samples": [0.47, 0.48, 0.49] },
    "run.decel_shape":  { "class": "linear", "exponent": 1.02, "r2": 0.99 }
  },
  "contract": {                      // present only if a contract was given
    "name": "snappy",
    "source": "presets/snappy.json",
    "passed": false,
    "rules": [
      { "metric": "input.latency_to_motion_frames",
        "rule": { "max": 3 }, "value": 2, "pass": true,  "delta": 0 },
      { "metric": "jump.apex_time_s",
        "rule": { "range": [0.30, 0.42] }, "value": 0.48, "pass": false, "delta": 0.14,
        "hint": "reduce by ~0.06 s" },
      { "metric": "run.decel_shape",
        "rule": { "shape": "ease-out", "exponent_min": 2.0 },
        "value": { "class": "linear", "exponent": 1.02 }, "pass": false, "delta": 0.70,
        "hint": "decel is linear; contract wants ease-out (fast initial slowdown)" }
    ]
  },
  "warnings": [
    "assist.input_buffer_ms: not probed by this input script"
  ]
}
```

- `metrics` carries every metric the pack could compute, contract or not. Per-jump /
  per-event values go in `samples`; the headline `value` is the mean.
- `delta` is the normalized distance-to-target from [feel-contracts.md](feel-contracts.md)
  - the agent's gradient.
- `hint` is a short, mechanical suggestion derived from the delta. Hints state *what to
  change in the measurement*, never *which line of code to edit* - that's the agent's job.
- `warnings` lists metrics that couldn't be computed and rules that referenced them.

## Terminal summary

Rendered from the JSON, roughly:

```
kite run jump_test - vs contract: snappy            FAIL (2/4 rules)

  ✓ input.latency_to_motion_frames   2 frames        (max 3)
  ✗ jump.apex_time_s                 0.48 s          (target 0.30-0.42)   → reduce ~0.06 s
  ✓ jump.rise_fall_ratio             1.31            (target 1.0-1.4)
  ✗ run.decel_shape                  linear (k=1.02) (want ease-out)      → fast initial slowdown

  ⚠ assist.input_buffer_ms not probed by this input script

  telemetry: runs/jump_test/2026-06-05T21-00-00.jsonl
```
