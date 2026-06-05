# Layer 2 - Feel contracts (`kite_contract` 0.1, draft)

A feel contract is a JSON file of target rules over [metric names](metrics.md). It answers
"does this game feel the way I want?" with per-rule pass/fail and a numeric
distance-to-target - the form an agent can iterate against.

Archetypes are **not special**: `snappy`, `floaty`, and `weighty` are just contract files
Kite ships as presets. Fork one, adjust ranges, commit it next to your tests.

## Format

```jsonc
{
  "kite_contract": "0.1",
  "name": "snappy",
  "extends": null,            // or a path / preset name to inherit rules from
  "rules": {
    "input.latency_to_motion_frames": { "max": 3 },
    "jump.apex_time_s":               { "range": [0.30, 0.42] },
    "jump.rise_fall_ratio":           { "range": [1.0, 1.4] },
    "run.decel_shape":                { "shape": "ease-out", "exponent_min": 2.0 },
    "assist.coyote_window_ms":        { "range": [60, 120] }
  }
}
```

### Rule types

| Rule | Applies to | Passes when |
|---|---|---|
| `{ "max": n }` | scalar | value ≤ n |
| `{ "min": n }` | scalar | value ≥ n |
| `{ "range": [a, b] }` | scalar | a ≤ value ≤ b |
| `{ "shape": c, "exponent_min"/"exponent_max": n }` | shape | class matches `c` and exponent bound holds; ignored (warn) if `r2` < 0.8 |

A rule naming a metric absent from the report is a warning, not a failure (the metric pack
may not have been able to compute it). `extends` merges rules, child wins per metric name.

Deliberately small. Likely v0.2 extensions, not in v0.1: per-rule severity/weights,
expressions, cross-metric rules.

## Evaluation output

For each rule the report carries pass/fail plus a normalized **delta** - how far outside
the bound the value is, as a fraction of the bound (0 = passing). Deltas give the agent a
gradient: "apex_time 0.48 vs max 0.42 → delta 0.14, reduce by ~0.06 s".

## Shipped presets (values PROVISIONAL)

> ⚠️ The preset *format* is fixed at v0.1; the preset *values* below are placeholders to
> be tuned empirically against real games before v0.1 ships. Do not treat them as canon.

| Metric | snappy | floaty | weighty |
|---|---|---|---|
| `input.latency_to_motion_frames` | max 3 | max 6 | max 5 |
| `jump.apex_time_s` | 0.30-0.42 | 0.50-0.70 | 0.38-0.52 |
| `jump.rise_fall_ratio` | 1.0-1.4 | 0.8-1.1 | 1.3-1.8 |
| `jump.hang_time_s` | max 0.10 | min 0.09 | max 0.12 |
| `run.accel_time_to_max_s` | max 0.15 | 0.2-0.5 | min 0.35 |
| `run.decel_time_to_stop_s` | max 0.10 | min 0.25 | min 0.30 |
| `run.decel_shape` | ease-out (k≥2) | linear | ease-in (k≤0.7) |
| `assist.coyote_window_ms` | 60-120 | - | 40-100 |

The shipped preset files live in [`presets/`](../presets/).

The golden-baseline workflow falls out of this format: `kite snapshot` (v0.2) writes your
current metrics as a contract with tight ranges; CI fails when feel drifts.
