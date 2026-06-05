# Testing Kite itself

Kite's three-layer split gives each layer its own natural test harness. The
organizing principle: **expected answers come from math, never from blessed
output** - a golden file can enshrine a bug; a closed-form expectation can't.

## Analyzer (metrics + contracts) - no Godot required

The analyzer only ever reads JSONL, so it's tested against **synthetic
telemetry** generated from known kinematics:

- [`test/synth.ts`](../test/synth.ts) simulates the same semi-implicit Euler
  integration the engine uses (gravity → velocity → position, per fixed
  tick). Generate a jump with `jumpVelocity: 260, gravityRise: 500` and the
  apex-time metric must recover `260/500 = 0.52 s` - the assertion is
  analytic, not a snapshot.
- Discretization is accounted for, not fudged: semi-implicit Euler at 60 Hz
  overshoots a continuous apex by `~v·dt/2`; landing quantizes to whole
  frames. Tests assert against the *discrete* expectation or carry exactly
  that tolerance - see the rise:fall test for the worked example.
- Contract evaluation is a pure function (metrics + contract → verdicts):
  table-driven unit tests.
- Real-recording integration tests pin committed telemetry from the fixture
  (`test/fixtures/*.jsonl`) and assert metrics against the fixture's
  documented constants - this catches "recorder and analyzer wrong in
  compensating ways".

Run with `npm test`. Milliseconds, no engine.

## Recorder (the Godot addon)

- **The determinism gate** is the conformance test: record the same input
  script twice, byte-diff everything after the meta line.
  `tools/verify-determinism.ps1` runs it locally; CI runs it on every test
  script in the fixture for every PR. If this fails, every metric downstream
  is noise - nothing else matters until it's green.
- The fixture's movement constants are deliberately hand-pickable and
  documented with their closed forms (`fixture/player/movement_params.gd`),
  so real recordings can be checked against hand-computed expectations.

## End to end

One CLI smoke in CI: the fixture's floaty defaults must PASS the floaty
contract via a real `kite run`. Not a matrix - the layers below it carry the
real coverage.

## What's deliberately not automated

Agent-in-the-loop convergence (an agent tuning the fixture to a contract) is
validated manually - it's expensive, nondeterministic, and a human watches it
anyway. If you change the report format, run that loop by hand before
claiming the change helps agents.
