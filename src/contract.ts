// Layer 2 - feel contract loading and evaluation (docs/feel-contracts.md).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isShapeValue, type MetricValue } from "./types.js";

export interface ScalarRule {
  max?: number;
  min?: number;
  range?: [number, number];
}

export interface ShapeRule {
  shape: "linear" | "ease-in" | "ease-out";
  exponent_min?: number;
  exponent_max?: number;
}

export type Rule = ScalarRule | ShapeRule;

export interface FeelContract {
  kite_contract: string;
  name: string;
  extends?: string | null;
  rules: Record<string, Rule>;
}

export interface RuleResult {
  metric: string;
  rule: Rule;
  value: MetricValue;
  pass: boolean;
  /** normalized distance outside the violated bound; 0 when passing */
  delta: number;
  hint?: string;
}

export interface ContractResult {
  name: string;
  source?: string;
  passed: boolean;
  rules: RuleResult[];
  warnings: string[];
}

/** minimum fit quality before a shape rule is enforced */
const SHAPE_R2_FLOOR = 0.8;
const MAX_EXTENDS_DEPTH = 10;

export function loadContract(
  ref: string,
  presetsDir: string,
  depth = 0,
): { contract: FeelContract; source: string } {
  if (depth > MAX_EXTENDS_DEPTH) {
    throw new Error(`contract extends chain too deep at "${ref}"`);
  }
  const source = existsSync(ref) ? ref : join(presetsDir, `${ref}.json`);
  if (!existsSync(source)) {
    throw new Error(`contract "${ref}" not found (looked for a file, then ${source})`);
  }
  const contract = JSON.parse(readFileSync(source, "utf8")) as FeelContract;
  if (!contract.rules || typeof contract.rules !== "object") {
    throw new Error(`${source} is not a feel contract (no rules)`);
  }
  if (contract.extends) {
    const parent = loadContract(contract.extends, presetsDir, depth + 1);
    contract.rules = { ...parent.contract.rules, ...contract.rules };
  }
  return { contract, source };
}

export function evaluateContract(
  contract: FeelContract,
  metrics: Record<string, MetricValue | undefined>,
): ContractResult {
  const results: RuleResult[] = [];
  const warnings: string[] = [];

  for (const [metric, rule] of Object.entries(contract.rules)) {
    const value = metrics[metric];
    if (value === undefined) {
      warnings.push(`${metric}: not present in this report; rule skipped`);
      continue;
    }
    if (isShapeRule(rule)) {
      if (!isShapeValue(value)) {
        warnings.push(`${metric}: rule expects a shape metric; rule skipped`);
        continue;
      }
      if (value.r2 < SHAPE_R2_FLOOR) {
        warnings.push(
          `${metric}: curve fit r2=${value.r2} below ${SHAPE_R2_FLOOR}; shape rule skipped`,
        );
        continue;
      }
      results.push(evalShape(metric, rule, value));
    } else {
      if (isShapeValue(value)) {
        warnings.push(`${metric}: rule expects a scalar metric; rule skipped`);
        continue;
      }
      results.push(evalScalar(metric, rule, value));
    }
  }

  return {
    name: contract.name,
    passed: results.length > 0 && results.every((r) => r.pass),
    rules: results,
    warnings,
  };
}

function evalScalar(
  metric: string,
  rule: ScalarRule,
  value: { value: number; unit: string },
): RuleResult {
  const lo = rule.range ? rule.range[0] : rule.min;
  const hi = rule.range ? rule.range[1] : rule.max;
  const v = value.value;

  if (hi !== undefined && v > hi) {
    return {
      metric,
      rule,
      value,
      pass: false,
      delta: round3((v - hi) / denom(hi)),
      hint: `reduce by ~${fmt(v - hi)} ${value.unit}`,
    };
  }
  if (lo !== undefined && v < lo) {
    return {
      metric,
      rule,
      value,
      pass: false,
      delta: round3((lo - v) / denom(lo)),
      hint: `increase by ~${fmt(lo - v)} ${value.unit}`,
    };
  }
  return { metric, rule, value, pass: true, delta: 0 };
}

function evalShape(
  metric: string,
  rule: ShapeRule,
  value: { class: string; exponent: number; r2: number },
): RuleResult {
  const classOk = value.class === rule.shape;
  let delta = 0;
  let exponentHint = "";

  if (rule.exponent_min !== undefined && value.exponent < rule.exponent_min) {
    delta = Math.max(delta, (rule.exponent_min - value.exponent) / denom(rule.exponent_min));
    exponentHint = `; raise exponent to ≥ ${rule.exponent_min}`;
  }
  if (rule.exponent_max !== undefined && value.exponent > rule.exponent_max) {
    delta = Math.max(delta, (value.exponent - rule.exponent_max) / denom(rule.exponent_max));
    exponentHint = `; lower exponent to ≤ ${rule.exponent_max}`;
  }
  const pass = classOk && delta === 0;
  if (!classOk && delta === 0) delta = 1; // wrong class with no exponent gradient

  return {
    metric,
    rule,
    value: value as MetricValue,
    pass,
    delta: round3(delta),
    hint: pass
      ? undefined
      : `${value.class} (k=${value.exponent}); contract wants ${rule.shape}${exponentHint}`,
  };
}

function isShapeRule(rule: Rule): rule is ShapeRule {
  return "shape" in rule;
}

function denom(x: number): number {
  return Math.abs(x) > 1e-9 ? Math.abs(x) : 1;
}

function fmt(x: number): string {
  const a = Math.abs(x);
  if (a >= 100) return x.toFixed(0);
  if (a >= 1) return x.toFixed(2);
  return x.toFixed(3);
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
