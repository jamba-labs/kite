# Contributing to Kite

Thanks for being here. Issues, PRs, and "this felt wrong on my project"
reports are all welcome - feel measurement is empirical, and other people's
games are the best test suite we could ask for.

## Dev setup

```sh
git clone https://github.com/jamba-labs/kite
cd kite
npm install
npm run build      # tsc → dist/
npm test           # vitest - analyzer tests, no Godot needed
```

For anything touching the recorder/addon you also need **Godot 4.x** on PATH
(or set `KITE_GODOT`), then:

```sh
pwsh tools/verify-determinism.ps1 -Test tests/feel_test.inputs.json   # the gate
node dist/cli.js run feel_test --project fixture --contract floaty    # smoke
```

## Layout

```
src/            analyzer + CLI + MCP server (TypeScript)
test/           vitest suites + synthetic telemetry generator
fixture/        instrumented Godot project; the addon you EDIT lives here:
                fixture/addons/kite/
addons/kite/    generated ship copy of the addon (what the Asset Library
                installs) - do not edit directly; run tools/sync-addon.ps1
presets/        shipped feel contracts
docs/           the spec (telemetry / metrics / contracts / report) + guides
tools/          determinism gate + addon sync scripts
```

**Editing the addon:** edit `fixture/addons/kite/` (that's where Godot opens
it), then run `pwsh tools/sync-addon.ps1` to copy it to the repo-root
`addons/kite/`. CI fails if the two drift. The repo-root copy plus a
`.gitattributes` `export-ignore` list is what keeps the Godot Asset Library
archive addon-only.

## The two house rules

1. **Analyzer changes need tests whose expected answers come from math.**
   Generate synthetic telemetry with known kinematics and assert the metric
   recovers the analytic value - don't bless current output as a golden file.
   See [docs/testing.md](docs/testing.md) for the philosophy and helpers.
2. **Recorder changes must keep the determinism gate green.** Same input
   script + same seed → byte-identical telemetry is the foundation everything
   sits on. CI runs the gate on every PR; run it locally before pushing.

## Conventions worth knowing

- Layers only reference downward (contracts → metrics → telemetry); engine
  adapters are dumb recorders. PRs that move analysis into the addon will be
  asked to move it back out.
- Canonical metric names are API - renaming one is a breaking change.
- Readers skip unknown JSON keys/kinds; writers only add, never repurpose.
- Schema versions are `0.x` and may break until v0.1 ships; after that,
  additive only.

## Good first contributions

- Run Kite on your own game and report where the metrics mislead or the
  defaults break - with the telemetry file attached if you can
- Metric-pack gaps: variable jump height, air control, landing recovery
- Preset value tuning with evidence ("X game feels snappy and measures Y")
- Quickstart friction on platforms/setups we haven't tried

## Conduct

Be kind, assume good faith: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
