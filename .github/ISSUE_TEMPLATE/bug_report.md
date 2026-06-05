---
name: Bug report
about: Something measured wrong, crashed, or broke determinism
labels: bug
---

**What happened**

**What you expected**

**Setup**
- Kite version:
- Godot version:
- OS:
- Your project or the fixture?

**The telemetry, if you have it**
Attach the `runs/*.jsonl` and `runs/*.report.json` for the run - they make
most feel-measurement bugs diagnosable without a repro project.

**Determinism check (for recorder issues)**
Output of `pwsh tools/verify-determinism.ps1` against your test, if relevant.
