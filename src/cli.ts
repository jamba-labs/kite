#!/usr/bin/env node
// kite CLI: `kite run <test>` launches the game via the Godot addon, analyzes
// the telemetry, writes report.json, prints the summary. `kite probe`
// measures assist windows. `kite init` scaffolds a project. Exit codes:
// 0 ok / contract passed, 1 contract failed, 2 error.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { KiteError, listTests, resolveProject, runProbes, runTest } from "./runner.js";
import { renderSummary } from "./summary.js";

function main(): number {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    switch (cmd) {
      case "run":
        return cmdRun(rest);
      case "probe":
        return cmdProbe(rest);
      case "list":
        return cmdList(rest);
      case "init":
        return cmdInit(rest);
      default:
        console.log(HELP);
        return cmd === undefined || cmd === "help" || cmd === "--help" ? 0 : 2;
    }
  } catch (e) {
    if (e instanceof KiteError) {
      console.error(`error: ${e.message}`);
      return 2;
    }
    throw e;
  }
}

function cmdRun(args: string[]): number {
  const flags = parseFlags(args);
  const testArg = flags._[0];
  if (!testArg) {
    console.error(
      "usage: kite run <test> [--contract <name|path>] [--seed <n>] [--project <dir>] [--godot <path>]",
    );
    return 2;
  }
  const project = resolveProject(flags.project);
  const outcome = runTest(project, testArg, {
    contract: flags.contract,
    seed: flags.seed,
    godot: flags.godot,
    windowed: "windowed" in flags ? true : undefined,
  });
  console.log(renderSummary(outcome.report));
  console.log(`  report:    ${outcome.reportPath}`);
  return outcome.passed ? 0 : 1;
}

function cmdProbe(args: string[]): number {
  const flags = parseFlags(args);
  const which = (flags._[0] ?? "all") as "coyote" | "buffer" | "all";
  const project = resolveProject(flags.project);
  const { results, runCount } = runProbes(project, which, {
    seed: flags.seed,
    godot: flags.godot,
  });
  for (const [name, r] of Object.entries(results)) {
    console.log(
      `  assist.${name}_window_ms   ${r.windowMs} ms   (${r.offsetsTried.length} offsets probed)`,
    );
  }
  console.log(
    `  cached to runs/assist.json (${runCount} runs) - future kite run reports include assist.*`,
  );
  return 0;
}

function cmdList(args: string[]): number {
  const flags = parseFlags(args);
  const project = resolveProject(flags.project);
  for (const t of listTests(project)) console.log(t);
  return 0;
}

function cmdInit(args: string[]): number {
  const flags = parseFlags(args);
  const project = resolve(flags.project ?? ".");
  if (!existsSync(join(project, "project.godot"))) {
    console.error(
      `error: ${project} is not a Godot project (no project.godot). Run from your project root or use --project.`,
    );
    return 2;
  }

  const kiteJson = join(project, "kite.json");
  if (!existsSync(kiteJson)) {
    writeFileSync(
      kiteJson,
      JSON.stringify(
        { kite_config: "0.1", scene: "", axes: { move_x: ["move_left", "move_right"] } },
        null,
        2,
      ) + "\n",
    );
    console.log('created kite.json - set "scene" to the scene your tests should run');
  }

  const testsDir = join(project, "tests");
  mkdirSync(testsDir, { recursive: true });
  const sample = join(testsDir, "jump_test.inputs.json");
  if (!existsSync(sample)) {
    writeFileSync(
      sample,
      JSON.stringify(
        {
          kite_inputs: "0.1",
          actions: { jump: "digital" },
          events: [
            { f: 60, a: "jump", v: 1 },
            { f: 66, a: "jump", v: 0 },
            { f: 240, a: "end" },
          ],
        },
        null,
        2,
      ) + "\n",
    );
    console.log("created tests/jump_test.inputs.json");
  }

  console.log(`
next steps:
  1. copy the Kite addon into ${join(project, "addons", "kite")} and register the
     KiteHarness autoload (Project Settings → Plugins, or [autoload] in project.godot)
  2. add your player node to the "kite_track" group
  3. kite run jump_test --contract snappy`);
  return 0;
}

function parseFlags(args: string[]): { _: string[] } & Record<string, string | undefined> {
  const out = { _: [] as string[] } as { _: string[] } & Record<string, string | undefined>;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
      else out[a.slice(2)] = args[++i];
    } else {
      out._.push(a);
    }
  }
  return out;
}

const HELP = `kite - game-feel telemetry for coding agents

usage:
  kite run <test> [--contract <name|path>] [--seed <n>] [--project <dir>] [--godot <path>]
  kite probe [coyote|buffer|all] [--project <dir>] [--godot <path>]
  kite list [--project <dir>]
  kite init [--project <dir>]

run    launch the game headless, replay <test>, write runs/<test>.report.json,
       print the summary. Exits 1 if the contract fails.
probe  measure assist windows empirically (frame-offset sweep); caches to
       runs/assist.json, which future kite run reports include.
list   list available tests.
init   scaffold kite.json and a sample test in a Godot project.

contracts: a preset name (snappy | floaty | weighty) or a path to a .json file.
godot binary: --godot, then kite.json "godot", then $KITE_GODOT, then "godot" on PATH.
demo mode: --windowed on kite run (or KITE_WINDOWED=1) shows the game window
while recording; telemetry is identical either way.
MCP server: kite-mcp (same package) exposes kite_run / kite_probe / kite_list_tests.
`;

process.exit(main());
