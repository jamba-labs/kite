// Layer 0 reader - parses kite_telemetry 0.1 JSONL (docs/telemetry.md).
// Unknown record kinds and unknown keys are skipped by design.

export interface TelemetryMeta {
  k: "meta";
  kite_telemetry: string;
  engine: string;
  engine_version?: string;
  adapter_version?: string;
  test?: string;
  scene?: string;
  fixed_fps: number;
  seed?: number;
  input_script?: string;
  input_script_sha256?: string;
  units?: Record<string, string>;
  /** viewport size [w, h] in project coordinate units; reference for scale-relative metrics */
  viewport?: [number, number];
  entities?: Record<string, string>;
  started_utc?: string;
  [key: string]: unknown;
}

export interface FrameEntity {
  /** position [x, y]; y grows downward (Godot 2D) */
  p?: [number, number];
  /** velocity [x, y] */
  v?: [number, number];
  /** node offset [x, y] - shake/recoil independent of follow position (Camera2D) */
  o?: [number, number];
  /** state-machine state name */
  s?: string;
  /** animation name */
  a?: string;
}

export interface TelemetryFrame {
  k: "frame";
  f: number;
  t: number;
  in: Record<string, number>;
  e: Record<string, FrameEntity>;
}

export interface Recording {
  meta: TelemetryMeta;
  frames: TelemetryFrame[];
}

export function parseTelemetry(jsonl: string): Recording {
  const lines = jsonl.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) throw new Error("empty telemetry");
  let meta: TelemetryMeta | undefined;
  const frames: TelemetryFrame[] = [];
  for (const line of lines) {
    const obj = JSON.parse(line) as { k?: string };
    if (obj.k === "meta" && meta === undefined) {
      meta = obj as TelemetryMeta;
    } else if (obj.k === "frame") {
      frames.push(obj as TelemetryFrame);
    }
  }
  if (meta === undefined) throw new Error("telemetry has no meta line");
  if (!meta.fixed_fps || meta.fixed_fps <= 0) {
    throw new Error("telemetry meta has no valid fixed_fps");
  }
  frames.sort((a, b) => a.f - b.f);
  return { meta, frames };
}
