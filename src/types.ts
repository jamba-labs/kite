// Shared metric value shapes (docs/metrics.md): a metric is either a scalar
// with a unit or a fitted curve shape.

export interface ScalarValue {
  value: number;
  unit: string;
  samples?: number[];
}

export interface ShapeValue {
  class: "linear" | "ease-in" | "ease-out";
  exponent: number;
  r2: number;
}

export type MetricValue = ScalarValue | ShapeValue;

export function isShapeValue(v: MetricValue): v is ShapeValue {
  return "class" in v;
}
