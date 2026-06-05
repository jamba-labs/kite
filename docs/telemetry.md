# Layer 0 - Telemetry schema (`kite_telemetry` 0.1, draft)

One recording = one JSONL file: one JSON object per line, written append-only during the
run. Every line has a `"k"` (kind) field. v0.1 defines two kinds: `meta` and `frame`.
Readers must skip lines with unknown kinds and ignore unknown keys.

## `meta` - first line of the file

```json
{
  "k": "meta",
  "kite_telemetry": "0.1",
  "engine": "godot",
  "engine_version": "4.3.0",
  "adapter_version": "0.1.0",
  "test": "jump_test",
  "scene": "res://tests/jump_test.tscn",
  "fixed_fps": 60,
  "seed": 12345,
  "input_script": "jump_test.inputs.json",
  "input_script_sha256": "9f2c...",
  "units": { "position": "px", "velocity": "px/s", "time": "s" },
  "entities": { "player": "Player (res://player/player.tscn)" },
  "started_utc": "2026-06-05T21:00:00Z"
}
```

- `units` are declared, not assumed - Godot 2D records px / px/s / s; other engines
  declare their own. Layer 1 normalizes using this block.
- `entities` maps short ids (used in every `frame` line) to a human-readable description
  of the tracked node.

## `frame` - one line per physics frame

Sampled **every** physics frame, no skipping, from injection start to test end.

```json
{
  "k": "frame",
  "f": 132,
  "t": 2.2,
  "in": { "jump": 1, "move_x": -1.0 },
  "e": {
    "player": { "p": [312.0, 188.5], "v": [-140.0, 0.0], "s": "run", "a": "run_loop" }
  }
}
```

| Key | Meaning |
|---|---|
| `f` | physics frame number, 0-based from injection start |
| `t` | seconds since injection start; always `f / fixed_fps` |
| `in` | input state this frame (not events): digital actions as `0`/`1`, analog axes as floats. Only actions named in the input script appear. |
| `e` | tracked entities by id |
| `e.*.p` | position `[x, y]` |
| `e.*.v` | velocity `[x, y]` |
| `e.*.s` | state-machine state name (string), if the entity exposes one |
| `e.*.a` | current animation name, if any |

States are recorded *per frame*, not as transition events - transitions are derived by
Layer 1 (`s` changed between frame N-1 and N). This keeps recorders dumb.

## Input script format (`kite_inputs` 0.1)

What the injector replays. Events are pinned to physics frame numbers, which is what makes
replay deterministic by construction.

```json
{
  "kite_inputs": "0.1",
  "actions": { "jump": "digital", "move_x": "axis" },
  "events": [
    { "f": 10, "a": "move_x", "v": 1.0 },
    { "f": 60, "a": "jump",   "v": 1 },
    { "f": 66, "a": "jump",   "v": 0 },
    { "f": 200, "a": "end" }
  ]
}
```

- `v` is the new value the action holds from frame `f` onward (state, not edge).
- `{ "a": "end" }` terminates the recording.
- Action names map to the engine's input actions (Godot: `Input` action names).

## Determinism requirements (the recorder's contract)

A conforming adapter must guarantee: same input script + same seed → **byte-identical
telemetry** (excluding `started_utc`). Concretely, for Godot:

1. Inputs are applied at physics-frame boundaries, never mid-frame or on render frames.
2. Physics runs at the fixed timestep declared in `fixed_fps`; the recorder refuses to
   record if the project overrides it variably.
3. The adapter seeds Godot's global RNG with `seed` at injection start; game code using
   its own RNG must accept a seed (documented guidance, can't be enforced).

The conformance test is exactly this: record the same scene twice with the same script
and diff the files.
