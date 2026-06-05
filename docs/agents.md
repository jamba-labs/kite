# Kite for agents - the tune loop

This page is written to be *dropped into your project's agent context*
(`CLAUDE.md`, `AGENTS.md`, or equivalent). Copy the snippet below and your
agent can tune game feel measurably instead of guessing. Kite measures
behavior and reports it; the agent decides what code to change - Kite never
reads your source, so it works the same whether your feel values live in
constants, exported variables, resources, curves, or scattered magic numbers.

## Drop-in snippet

```markdown
## Game feel - use Kite

This project is instrumented with Kite (game-feel telemetry). You cannot
play the game; Kite plays it for you and reports how it feels.

When asked to change how the game feels:

1. **Measure first.** Call `kite_run` (MCP) or `kite run <test> --contract
   <target>` with the relevant test. The report gives per-rule pass/fail
   plus a numeric delta and a hint - that is your gradient. Never tune
   blind.
2. **Change the code that drives the failing metric.** Find wherever the
   relevant feel value lives in this project (gravity, accel curve, jump
   force, assist window - in whatever form the code stores it) and edit it.
   Kite measures the resulting behavior; it does not care how the value is
   stored.
3. **Re-run and compare.** Runs are deterministic: same code + same seed →
   identical metrics. If a metric didn't move, your edit didn't affect it.
4. **Assist windows (coyote time, input buffering) need `kite_probe`,**
   not `kite_run`. It is slow (~15 game launches) - run it only after
   changing assist behavior. Probed values run ~1-2 physics frames under
   what the code nominally sets (engine input latency), so aim slightly high.
5. **Done when** the contract reports PASS (exit code 0).

If a jump uses constant gravity, these closed forms let you compute target
values from the deltas instead of iterating blind (otherwise, just nudge
toward the delta and re-measure):
- apex_time = jump_velocity / gravity_rise
- apex_height = jump_velocity² / (2 · gravity_rise)
- rise:fall ratio = sqrt(gravity_fall / gravity_rise)
```

## MCP setup

```sh
claude mcp add kite -- npx -y -p @jamba-labs/kite kite-mcp --project .
```

| Tool | Use |
|---|---|
| `kite_run` | replay a test, get metrics + contract verdict (call after every edit) |
| `kite_probe` | empirically measure coyote/buffer windows (slow; only after assist edits) |
| `kite_list_tests` | discover available tests |
| `kite_report` | re-read the last report without re-running |

Set `KITE_WINDOWED=1` in the server env to make runs visibly play on screen
(telemetry is identical; useful for demos and humans watching).

## What the report gives the agent

- **Canonical metric names** (`jump.apex_time_s`, `run.decel_shape`, ...) - a
  stable vocabulary, defined in [metrics.md](metrics.md)
- **Per-rule verdicts with normalized deltas** - "0.5367 s vs max 0.42 →
  reduce by ~0.117 s" is a gradient, not a vibe
- **Curve exponents that map to implementable knobs** - if the contract wants
  `ease-out, k≥2`, the fix is an easing/exponent the controller already exposes
  somewhere
- **Determinism** - re-measuring is free of noise, so a one-metric change is
  attributable to the one thing you edited

## A worked example

The [fixture platformer](../fixture/) ships deliberately floaty. An agent
given only "make this game feel snappy" measured 1/8 snappy rules passing,
computed new constants from the closed forms above, set the assists, probed
them, and re-measured: 8/8 PASS - one edit cycle, no human corrections. The
fixture's [CLAUDE.md](../fixture/CLAUDE.md) is this snippet instantiated for
that project.
