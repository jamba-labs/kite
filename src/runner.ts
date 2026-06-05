// Shared core for the CLI and the MCP server: launch Godot via the addon,
// analyze telemetry, evaluate contracts, run assist probes. No printing, no
// process.exit - callers decide how to surface results.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContract } from "./contract.js";
import { probeBuffer, probeCoyote, type AssistProbeResult, type InputEvent, type ProbeRunner } from "./probe.js";
import { buildReport, type Report } from "./report.js";
import { parseTelemetry, type Recording } from "./telemetry.js";
import type { MetricValue } from "./types.js";

export const PRESETS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "presets");

export interface KiteConfig {
  scene?: string;
  axes?: Record<string, [string, string]>;
  godot?: string;
  probes?: Record<string, { base?: string }>;
}

export interface RunOptions {
  contract?: string;
  seed?: string;
  godot?: string;
  /** show the game window while recording (demo mode); also via KITE_WINDOWED=1 */
  windowed?: boolean;
}

export interface RunOutcome {
  report: Report;
  /** project-relative path the report was written to */
  reportPath: string;
  /** false when a contract was evaluated and failed */
  passed: boolean;
}

export class KiteError extends Error {}

export function loadKiteConfig(project: string): KiteConfig {
  const p = join(project, "kite.json");
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as KiteConfig) : {};
}

export function resolveProject(dir?: string): string {
  const project = resolve(dir ?? process.env.KITE_PROJECT ?? ".");
  if (!existsSync(join(project, "project.godot"))) {
    throw new KiteError(`${project} is not a Godot project (no project.godot)`);
  }
  return project;
}

export function resolveGodot(project: string, override?: string): string {
  return override ?? loadKiteConfig(project).godot ?? process.env.KITE_GODOT ?? "godot";
}

export function listTests(project: string): string[] {
  const dir = join(project, "tests");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".inputs.json"))
    .map((f) => f.replace(".inputs.json", ""));
}

/** resolve a test name or path to a project-relative input-script path */
export function resolveTest(project: string, testArg: string): string {
  const candidates = [testArg, `tests/${testArg}.inputs.json`, `tests/${testArg}`];
  const found = candidates.find((c) => existsSync(join(project, c)));
  if (!found) {
    throw new KiteError(
      `test "${testArg}" not found in ${project} (tried: ${candidates.join(", ")}); available: ${listTests(project).join(", ") || "none"}`,
    );
  }
  return found;
}

export function runTest(project: string, testArg: string, opts: RunOptions = {}): RunOutcome {
  const testRel = resolveTest(project, testArg);
  const testName = testRel.split("/").pop()!.replace(".inputs.json", "");
  const outRel = `runs/${testName}.jsonl`;
  const godot = resolveGodot(project, opts.godot);

  const rec = runGodotTest(project, godot, testRel, outRel, opts.seed ?? "12345", opts.windowed);

  let contract;
  let contractSource;
  if (opts.contract) {
    const loaded = loadContract(opts.contract, PRESETS_DIR);
    contract = loaded.contract;
    contractSource = loaded.source;
  }

  // Merge cached assist probe results (kite probe) into the report.
  const extraMetrics: Record<string, MetricValue> = {};
  const extraWarnings: string[] = [];
  const assistPath = join(project, "runs/assist.json");
  if (existsSync(assistPath)) {
    const assist = JSON.parse(readFileSync(assistPath, "utf8")) as Record<string, unknown>;
    for (const key of ["coyote", "buffer"]) {
      const v = assist[`${key}_window_ms`];
      if (typeof v === "number") {
        extraMetrics[`assist.${key}_window_ms`] = { value: v, unit: "ms" };
      }
    }
    extraWarnings.push(
      "assist.*: from cached probe results (runs/assist.json); run kite probe to refresh",
    );
  }

  const report = buildReport(rec, { telemetryPath: outRel, contract, contractSource, extraMetrics });
  report.warnings.push(...extraWarnings);

  const reportPath = `runs/${testName}.report.json`;
  mkdirSync(dirname(join(project, reportPath)), { recursive: true });
  writeFileSync(join(project, reportPath), JSON.stringify(report, null, 2) + "\n");

  return { report, reportPath, passed: !report.contract || report.contract.passed };
}

export interface ProbeOutcome {
  results: Record<string, AssistProbeResult>;
  runCount: number;
}

export function runProbes(
  project: string,
  which: "coyote" | "buffer" | "all" = "all",
  opts: RunOptions = {},
): ProbeOutcome {
  const config = loadKiteConfig(project);
  const godot = resolveGodot(project, opts.godot);
  const seed = opts.seed ?? "12345";

  let runCount = 0;
  const runner: ProbeRunner = (events, _label) => {
    runCount++;
    const scriptRel = "runs/_probe.inputs.json";
    writeFileSync(
      join(project, scriptRel),
      JSON.stringify({ kite_inputs: "0.1", actions: probeActions(project, config), events }, null, 2),
    );
    return runGodotTest(project, godot, scriptRel, "runs/_probe.jsonl", seed, opts.windowed);
  };

  const results: Record<string, AssistProbeResult> = {};
  try {
    if (which === "coyote" || which === "all") {
      const base = readProbeBase(project, config, "coyote", "tests/coyote_probe.inputs.json");
      const entity = discoverEntity(base.events, runner);
      results.coyote = probeCoyote(base.events, runner, entity.id, entity.fps);
    }
    if (which === "buffer" || which === "all") {
      const base = readProbeBase(project, config, "buffer", "tests/buffer_probe.inputs.json");
      const entity = discoverEntity(base.events, runner);
      results.buffer = probeBuffer(base.events, runner, entity.id, entity.fps);
    }
  } finally {
    rmSync(join(project, "runs/_probe.inputs.json"), { force: true });
    rmSync(join(project, "runs/_probe.jsonl"), { force: true });
  }

  const cache: Record<string, unknown> = { kite_assist: "0.1" };
  if (results.coyote) cache.coyote_window_ms = results.coyote.windowMs;
  if (results.buffer) cache.buffer_window_ms = results.buffer.windowMs;
  mkdirSync(join(project, "runs"), { recursive: true });
  writeFileSync(join(project, "runs/assist.json"), JSON.stringify(cache, null, 2) + "\n");

  return { results, runCount };
}

export function runGodotTest(
  project: string,
  godot: string,
  testRel: string,
  outRel: string,
  seed: string,
  windowed?: boolean,
): Recording {
  // Physics runs at the fixed tick rate either way - windowed exists so demos
  // can show the scripted playback; telemetry is identical.
  const show = windowed ?? process.env.KITE_WINDOWED === "1";
  const godotArgs = [
    ...(show ? [] : ["--headless"]),
    "--path",
    project,
    "--",
    `--kite-test=${testRel}`,
    `--kite-out=${outRel}`,
    `--kite-seed=${seed}`,
  ];
  // cmd.exe /c resolves .cmd shims (how winget exposes godot on Windows).
  const proc =
    process.platform === "win32"
      ? spawnSync("cmd.exe", ["/c", godot, ...godotArgs], { encoding: "utf8" })
      : spawnSync(godot, godotArgs, { encoding: "utf8" });
  if (proc.error || proc.status !== 0) {
    throw new KiteError(
      `godot run failed (exit ${proc.status ?? "?"})\n${(proc.stderr ?? "").trim()}\n${(proc.stdout ?? "").trim()}`.trim(),
    );
  }
  const telemetryAbs = join(project, outRel);
  if (!existsSync(telemetryAbs)) {
    throw new KiteError(
      `recorder produced no telemetry at ${outRel}. Is the Kite addon installed and the KiteHarness autoload registered?`,
    );
  }
  return parseTelemetry(readFileSync(telemetryAbs, "utf8"));
}

function readProbeBase(
  project: string,
  config: KiteConfig,
  probe: string,
  fallback: string,
): { events: InputEvent[] } {
  const rel = config.probes?.[probe]?.base ?? fallback;
  const p = join(project, rel);
  if (!existsSync(p)) {
    throw new KiteError(`${probe} probe base test not found at ${rel}`);
  }
  return JSON.parse(readFileSync(p, "utf8")) as { events: InputEvent[] };
}

function probeActions(project: string, config: KiteConfig): Record<string, string> {
  // union of action declarations across probe base scripts
  const actions: Record<string, string> = { jump: "digital" };
  for (const [probe, fallback] of [
    ["coyote", "tests/coyote_probe.inputs.json"],
    ["buffer", "tests/buffer_probe.inputs.json"],
  ] as const) {
    const rel = config.probes?.[probe]?.base ?? fallback;
    const p = join(project, rel);
    if (existsSync(p)) {
      const base = JSON.parse(readFileSync(p, "utf8")) as { actions?: Record<string, string> };
      Object.assign(actions, base.actions);
    }
  }
  return actions;
}

function discoverEntity(
  baseEvents: InputEvent[],
  runner: ProbeRunner,
): { id: string; fps: number } {
  const end = baseEvents.find((e) => e.a === "end")?.f ?? 60;
  const rec = runner([{ f: Math.min(end, 10), a: "end" }], "discover");
  const id = Object.keys(rec.meta.entities ?? {})[0] ?? Object.keys(rec.frames[0]?.e ?? {})[0];
  if (!id) throw new KiteError("no tracked entities in telemetry");
  return { id, fps: rec.meta.fixed_fps };
}
