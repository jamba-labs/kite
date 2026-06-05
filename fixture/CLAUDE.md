# Kite fixture - agent guide

This is a minimal 2D platformer instrumented with **Kite**, a game-feel
harness. You cannot play the game, but you don't need to: Kite runs it with
scripted inputs and measures how it feels.

## The tune loop

When asked to change how the game feels (e.g. "make it snappy"):

1. **Measure first.** Run `kite_run` with test `feel_test` and the target
   contract (e.g. `snappy`). The report gives per-rule pass/fail plus a
   numeric delta and a hint - that's your gradient.
2. **Edit one place only:** `player/movement_params.gd`. Every feel constant
   lives there, each documented with the closed-form formula linking it to the
   metrics. Do not edit `player/player.gd` (the machinery) to change feel.
3. **Re-run `kite_run` and compare.** Constants map to metrics predictably:
   - `jump.apex_time_s` = `JUMP_VELOCITY / GRAVITY_RISE` - scale both to move
     apex time without changing height; raise `GRAVITY_RISE` alone to shorten
     and lower the jump
   - `jump.rise_fall_ratio` = `sqrt(GRAVITY_FALL / GRAVITY_RISE)`
   - `run.accel_time_to_max_s` ≈ `0.95 × ACCEL_TIME`; `run.decel_time_to_stop_s`
     tracks `DECEL_TIME`
   - `run.decel_shape` exponent is literally `DECEL_EXPONENT`
   - `assist.coyote_window_ms` / `assist.buffer_window_ms` track `COYOTE_MS` /
     `BUFFER_MS` (measured value runs ~1-2 frames under the configured one -
     engine input latency; aim slightly high)
4. **Assist constants need `kite_probe`,** not `kite_run` - run it after
   changing `COYOTE_MS` or `BUFFER_MS` (it's slow, ~15 game launches; don't
   run it after unrelated edits).
5. **Done when** `kite_run feel_test --contract <target>` reports PASS.

## Rules of the road

- Runs are deterministic: same constants + same seed → identical metrics.
  If a number didn't change, your edit didn't affect that metric.
- Change constants in small batches and re-measure rather than guessing a
  full set blind - the report tells you exactly how far off each metric is.
- `jump.apex_height_px` isn't in the contracts but players notice it: if you
  change `JUMP_VELOCITY` or `GRAVITY_RISE`, keep height ≈ `JV²/(2·G_RISE)`
  in mind (default ≈ 68 px; the ledge drop is 160 px).
- Keep values physically sensible (positive gravities, `ACCEL_TIME` > 0).

## Without MCP

The same loop works via the CLI from the repo root:
`node dist/cli.js run feel_test --project fixture --contract snappy`
(or `kite run ...` once installed). Exit code 1 = contract failed.
