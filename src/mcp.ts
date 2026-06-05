#!/usr/bin/env node
// Kite MCP server: thin wrapper over the runner exposing kite_run,
// kite_probe, kite_list_tests, and kite_report over stdio. This is the
// native surface for agents (Claude Code etc.).
//
//   claude mcp add kite -- npx -y @jamba-labs/kite-mcp        (once published)
//   claude mcp add kite -- node dist/mcp.js [--project <dir>] (from a checkout)
//
// Default project dir: --project arg, else $KITE_PROJECT, else cwd.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { KiteError, listTests, resolveProject, runProbes, runTest } from "./runner.js";
import { renderSummary } from "./summary.js";

const argProject = (() => {
  const i = process.argv.indexOf("--project");
  return i >= 0 ? process.argv[i + 1] : undefined;
})();

const server = new McpServer({ name: "kite", version: "0.1.0" });

const projectParam = z
  .string()
  .optional()
  .describe("Godot project directory (defaults to the server's configured project)");

server.registerTool(
  "kite_run",
  {
    title: "Run a Kite feel test",
    description:
      "Launch the game headless, replay the named input-script test, record frame-level telemetry, " +
      "and return game-feel metrics (input latency, jump arc, accel/decel curves). " +
      "Pass a contract (snappy | floaty | weighty, or a path to a contract .json) to get per-rule " +
      "pass/fail with numeric distance-to-target - the gradient to tune against. " +
      "Call this after every gameplay-constant edit to measure the effect. " +
      "Use the feel_test test for full coverage when available; kite_list_tests shows what exists.",
    inputSchema: {
      test: z.string().describe('test name (e.g. "feel_test") or project-relative path'),
      contract: z
        .string()
        .optional()
        .describe("feel contract: preset name (snappy | floaty | weighty) or path to a .json file"),
      seed: z.number().int().optional().describe("RNG seed (default 12345; keep fixed for comparable runs)"),
      project: projectParam,
    },
  },
  async ({ test, contract, seed, project }) => {
    try {
      const proj = resolveProject(project ?? argProject);
      const outcome = runTest(proj, test, {
        contract,
        seed: seed !== undefined ? String(seed) : undefined,
      });
      const text =
        renderSummary(outcome.report) +
        `\n\nreport.json:\n` +
        JSON.stringify(outcome.report, null, 2);
      return { content: [{ type: "text", text }], isError: false };
    } catch (e) {
      return errorResult(e);
    }
  },
);

server.registerTool(
  "kite_probe",
  {
    title: "Probe assist windows",
    description:
      "Empirically measure assist windows (coyote time, jump input buffer) by sweeping jump presses " +
      "at increasing frame offsets until one fails. Slower than kite_run (~10-20 game launches). " +
      "Results are cached and merged into subsequent kite_run reports as assist.* metrics - " +
      "re-run this after changing assist-related constants, not after every edit.",
    inputSchema: {
      which: z.enum(["coyote", "buffer", "all"]).optional().describe("which probe to run (default all)"),
      project: projectParam,
    },
  },
  async ({ which, project }) => {
    try {
      const proj = resolveProject(project ?? argProject);
      const { results, runCount } = runProbes(proj, which ?? "all");
      const lines = Object.entries(results).map(
        ([name, r]) =>
          `assist.${name}_window_ms = ${r.windowMs} ms (${r.offsetsTried.length} offsets probed)`,
      );
      lines.push(`cached to runs/assist.json after ${runCount} runs; kite_run reports now include assist.*`);
      return { content: [{ type: "text", text: lines.join("\n") }], isError: false };
    } catch (e) {
      return errorResult(e);
    }
  },
);

server.registerTool(
  "kite_list_tests",
  {
    title: "List available Kite tests",
    description: "List the input-script tests available in the project (tests/*.inputs.json).",
    inputSchema: { project: projectParam },
  },
  async ({ project }) => {
    try {
      const proj = resolveProject(project ?? argProject);
      const tests = listTests(proj);
      return {
        content: [
          {
            type: "text",
            text: tests.length > 0 ? tests.join("\n") : "no tests found (expected tests/*.inputs.json)",
          },
        ],
        isError: false,
      };
    } catch (e) {
      return errorResult(e);
    }
  },
);

server.registerTool(
  "kite_report",
  {
    title: "Read the last report for a test",
    description:
      "Return the most recent report.json for a test without re-running the game. " +
      "Use kite_run instead when the game code has changed since the last run.",
    inputSchema: {
      test: z.string().describe("test name"),
      project: projectParam,
    },
  },
  async ({ test, project }) => {
    try {
      const proj = resolveProject(project ?? argProject);
      const p = join(proj, `runs/${test}.report.json`);
      if (!existsSync(p)) {
        return {
          content: [{ type: "text", text: `no report for "${test}" yet - call kite_run first` }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: readFileSync(p, "utf8") }], isError: false };
    } catch (e) {
      return errorResult(e);
    }
  },
);

function errorResult(e: unknown): { content: Array<{ type: "text"; text: string }>; isError: true } {
  const msg = e instanceof KiteError ? e.message : String(e);
  return { content: [{ type: "text", text: `error: ${msg}` }], isError: true };
}

const transport = new StdioServerTransport();
await server.connect(transport);
