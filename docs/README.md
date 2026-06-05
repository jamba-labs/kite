# Kite spec (v0.1 draft)

Kite measures *game feel* and reports it in a form a coding agent can act on. The spec is
three layers, each deliberately ignorant of the layer above it:

| Layer | Doc | What it is | Who speaks it |
|---|---|---|---|
| 0 - Telemetry | [telemetry.md](telemetry.md) | Raw frame-sampled JSONL: inputs, positions, velocities, states. No opinions. | Engine adapters (recorders) |
| 1 - Metrics | [metrics.md](metrics.md) | Derived measurements: latency, jump arc, curve shape, assist windows. | The `kite` CLI analyzer |
| 2 - Feel contracts | [feel-contracts.md](feel-contracts.md) | Target rules over metric names. Archetypes (`snappy`, `floaty`, `weighty`) are shipped presets. | Devs and their agents |

The output of a run is a [report](report.md): Layer 1 values, plus - if a contract was
given - per-rule pass/fail with distance-to-target.

## Design rules

- **Adapters are dumb recorders.** All analysis happens above Layer 0. This is what makes
  a new engine a port, not a rewrite.
- **Layers only reference downward.** Contracts name metrics; metrics read telemetry;
  telemetry knows nothing.
- **Readers ignore what they don't know.** Unknown JSON keys and unknown record kinds are
  skipped, never errors. Writers may only add, never repurpose.
- **Determinism is a requirement, not a feature.** Same input script + same seed →
  byte-identical telemetry. A recorder that can't do this is broken.

## Versioning

Each layer carries its own version string (`kite_telemetry`, `kite_metrics`,
`kite_contract`). All are `0.1` and **unstable until v0.1 ships** - breaking changes
allowed without ceremony until then.
