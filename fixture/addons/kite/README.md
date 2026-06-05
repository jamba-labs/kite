# Kite addon (Godot)

Deterministic input injector + frame-sampled telemetry recorder. The engine
adapter half of Kite - it records, it does not analyze.

## Setup

1. Copy `addons/kite/` into your project.
2. Register the autoload: enable the plugin in Project Settings → Plugins, or
   add it directly to `project.godot` (works headless, no editor needed):

   ```ini
   [autoload]
   KiteHarness="*res://addons/kite/kite_harness.gd"
   ```

3. Put every node you want recorded in the `kite_track` group. If a node has a
   `velocity` property it's recorded as `v`; a `state` string property is
   recorded as `s`.
4. If your input scripts use logical axes (e.g. `move_x`), map them to your
   action pair in `kite.json` at the project root:

   ```json
   { "kite_config": "0.1", "scene": "res://scenes/gym.tscn",
     "axes": { "move_x": ["move_left", "move_right"] } }
   ```

## Running a test

```
godot --headless --path . -- --kite-test=tests/jump_test.inputs.json --kite-out=runs/jump.jsonl --kite-seed=12345
```

Without `--kite-test` the harness is inert - the game runs normally.

## Guarantees and caveats

- Same input script + same seed → byte-identical telemetry (excluding the
  `started_utc` timestamp in the meta line). If that doesn't hold for your
  project, look for RNG without a seed path, physics dependent on render
  timing, or input read outside `_physics_process`.
- Recorded `in` values are what `Input` reported after game code ran that
  frame - the *perceived* input. The engine may register an injected press on
  the physics frame after injection; telemetry reflects what the game could
  actually see, so latency measured from `in` edges is honest.
- Requires a fixed physics tick rate (reads `physics/common/physics_ticks_per_second`).
