# Layer 1 - Metric pack: 2D platformer movement (`kite_metrics` 0.1, draft)

Metrics are derived from telemetry, engine-agnostic, and addressed by **canonical dotted
names** - these names are the vocabulary that feel contracts (Layer 2) are written in.
Renaming a metric is a breaking change.

A metric value is either a **scalar** (`{ "value": 0.42, "unit": "s" }`) or a **shape**
(`{ "class": "ease-out", "exponent": 2.3, "r2": 0.98 }`).

## v0.1 metrics

### Input response

| Name | Unit | Definition |
|---|---|---|
| `input.latency_to_state_frames` | frames | input edge → first state-machine change attributable to it |
| `input.latency_to_motion_frames` | frames | input edge → first displacement on the relevant axis exceeding noise floor |

### Jump arc

Measured per jump (input edge on the jump action → landing), reported as the mean across
jumps in the run, with per-jump values available in the report.

| Name | Unit | Definition |
|---|---|---|
| `jump.apex_time_s` | s | jump input → vertical velocity crosses zero |
| `jump.apex_height_px` | px | max vertical displacement from takeoff position |
| `jump.rise_fall_ratio` | ratio | time rising : time falling (1.0 = symmetric) |
| `jump.hang_time_s` | s | time where \|vy\| < 10% of peak \|vy\| around the apex |

### Ground movement curves

Curve shape = least-squares fit of the velocity envelope to `v(t) ∝ t^k` (accel) or the
mirror `v(τ) ∝ (1 − τ/T)^k` (decel). The `exponent` is always the curve-family parameter
as implemented - the literal knob a dev tunes. The `class` is the *feel* label, so it maps
differently per phase:

- **accel:** `ease-out` k<1 (fast start), `ease-in` k>1 (slow start), `linear` ≈1
- **decel:** `ease-out` k>1 (fast initial slowdown - snappy), `ease-in` k<1, `linear` ≈1

`r2` reports fit quality so consumers can distrust low-confidence shapes.

| Name | Unit | Definition |
|---|---|---|
| `run.accel_time_to_max_s` | s | move input → 95% of max ground speed |
| `run.decel_time_to_stop_s` | s | input release → speed below noise floor |
| `run.accel_shape` | shape | curve fit of the accel envelope |
| `run.decel_shape` | shape | curve fit of the decel envelope |
| `run.max_speed_px_s` | px/s | sustained max ground speed |

### Assist windows (detected empirically)

These are *probed*, not read from config: the input script (or a generated probe variant)
attempts the action at increasing offsets and the metric reports the widest offset that
still succeeds. `0` means the assist doesn't exist; that's a value, not an error.

| Name | Unit | Definition |
|---|---|---|
| `assist.coyote_window_ms` | ms | latest post-ledge jump input that still triggers a jump |
| `assist.input_buffer_ms` | ms | earliest pre-landing jump input that still fires on landing |

## Notes

- All time metrics are computed from frame counts × the recording's `fixed_fps`, then
  expressed in the unit above - never from wall clock.
- "Noise floor" = 0.5 px/frame displacement, pending empirical tuning on the fixture.
- v0.2 candidates (out of scope, listed so names don't get squatted): `jump.variable_height_ratio`,
  `air.control_authority`, `land.recovery_frames`, juice/hitstop pack.
