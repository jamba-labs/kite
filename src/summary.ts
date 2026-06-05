// Renders the human-facing terminal summary from report.json (docs/report.md).

import type { Rule } from "./contract.js";
import type { Report } from "./report.js";
import { isShapeValue, type MetricValue } from "./types.js";

export function renderSummary(report: Report): string {
  const lines: string[] = [];

  if (report.contract) {
    const c = report.contract;
    const passed = c.rules.filter((r) => r.pass).length;
    const verdict = c.passed ? "PASS" : "FAIL";
    lines.push(
      `kite run ${report.test} - vs contract: ${c.name}`.padEnd(58) +
        `${verdict} (${passed}/${c.rules.length} rules)`,
    );
    lines.push("");
    for (const r of c.rules) {
      const mark = r.pass ? "✓" : "✗";
      const hint = r.hint ? `   → ${r.hint}` : "";
      lines.push(
        `  ${mark} ${r.metric.padEnd(33)} ${fmtValue(r.value).padEnd(18)} ${fmtRule(r.rule)}${hint}`,
      );
    }
  } else {
    lines.push(`kite run ${report.test} - no contract; reporting metrics`);
    lines.push("");
    for (const [name, value] of Object.entries(report.metrics)) {
      lines.push(`    ${name.padEnd(33)} ${fmtValue(value)}`);
    }
  }

  if (report.warnings.length > 0) {
    lines.push("");
    for (const w of report.warnings) lines.push(`  ⚠ ${w}`);
  }

  lines.push("");
  lines.push(`  telemetry: ${report.telemetry}`);
  return lines.join("\n");
}

function fmtValue(v: MetricValue): string {
  if (isShapeValue(v)) return `${v.class} (k=${v.exponent})`;
  return `${trim(v.value)} ${v.unit}`;
}

function fmtRule(rule: Rule): string {
  if ("shape" in rule) {
    const bounds = [
      rule.exponent_min !== undefined ? `k≥${rule.exponent_min}` : null,
      rule.exponent_max !== undefined ? `k≤${rule.exponent_max}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    return `(want ${rule.shape}${bounds ? `, ${bounds}` : ""})`;
  }
  if (rule.range) return `(target ${trim(rule.range[0])}-${trim(rule.range[1])})`;
  if (rule.max !== undefined) return `(max ${trim(rule.max)})`;
  if (rule.min !== undefined) return `(min ${trim(rule.min)})`;
  return "";
}

function trim(x: number): string {
  return Number.isInteger(x) ? String(x) : String(Math.round(x * 10000) / 10000);
}
