extends Node
## Deterministic input injector + frame-sampled telemetry recorder
## (kite_telemetry 0.1 schema, docs/telemetry.md). Idle unless launched with
## kite args after `--`:
##   godot --headless --path . -- --kite-test=tests/jump_test.inputs.json \
##       --kite-out=runs/jump_test.jsonl --kite-seed=12345
##
## Per physics step: on physics_frame, apply this frame's scripted inputs
## (before game code); then sample positions/velocities/states in the harness'
## own _physics_process (priority 1e6, so it runs last). The recorded `in` is
## what Input reported at sample time, so latency is measured against what the
## game could actually see.

const TELEMETRY_VERSION := "0.1"
const ADAPTER_VERSION := "0.1.0"
const TRACK_GROUP := "kite_track"
const CONFIG_PATH := "res://kite.json"

var _test_path := ""
var _out_path := ""
var _seed := 0

var _axes := {}             # logical axis name -> [negative_action, positive_action]
var _actions := {}          # action name -> "digital" | "axis"
var _events: Array = []     # sorted input events, "end" excluded
var _next_event := 0
var _end_frame := -1

var _running := false
var _frame := -1
var _tracked: Array[Node] = []
var _lines := PackedStringArray()
var _fixed_fps := 60
var _started_utc := ""


func _ready() -> void:
	process_physics_priority = 1000000  # sample after all game code
	var args := _parse_user_args()
	if not args.has("kite-test"):
		set_physics_process(false)
		return
	_test_path = args["kite-test"]
	_out_path = args.get("kite-out", "runs/out.jsonl")
	_seed = int(args.get("kite-seed", "0"))
	_fixed_fps = int(ProjectSettings.get_setting("physics/common/physics_ticks_per_second", 60))
	_load_config()
	if not _load_input_script():
		get_tree().quit(1)
		return
	_start.call_deferred()


func _start() -> void:
	# Let the main scene finish entering the tree, switch scene if the config
	# asks for a different one, then begin on the next physics frame boundary.
	await get_tree().process_frame
	var cfg_scene: String = _config_scene()
	if cfg_scene != "" and get_tree().current_scene.scene_file_path != cfg_scene:
		get_tree().change_scene_to_file(cfg_scene)
		await get_tree().process_frame
	seed(_seed)
	_tracked.clear()
	for n in get_tree().get_nodes_in_group(TRACK_GROUP):
		_tracked.append(n)
	if _tracked.is_empty():
		push_error("kite: no nodes in group \"%s\" - nothing to record" % TRACK_GROUP)
		get_tree().quit(1)
		return
	_started_utc = Time.get_datetime_string_from_system(true) + "Z"
	get_tree().physics_frame.connect(_on_physics_frame)
	_running = true


## Step 1: advance frame, inject this frame's events (runs before game code).
func _on_physics_frame() -> void:
	if not _running:
		return
	_frame += 1
	if _frame == _end_frame:
		_finish()
		return
	while _next_event < _events.size() and int(_events[_next_event]["f"]) == _frame:
		_apply_event(_events[_next_event])
		_next_event += 1


## Step 3: sample the frame after all game code has run.
func _physics_process(_delta: float) -> void:
	if not _running or _frame < 0:
		return
	var ents := {}
	for n in _tracked:
		var e := {}
		if n is Node2D:
			e["p"] = [snappedf(n.position.x, 0.001), snappedf(n.position.y, 0.001)]
		if "velocity" in n:
			e["v"] = [snappedf(n.velocity.x, 0.001), snappedf(n.velocity.y, 0.001)]
		if "offset" in n:
			e["o"] = [snappedf(n.offset.x, 0.001), snappedf(n.offset.y, 0.001)]
		if "state" in n:
			e["s"] = n.state
		ents[String(n.name)] = e
	var ins := {}
	for a in _actions:
		if _actions[a] == "axis":
			var pair: Array = _axes.get(a, [])
			ins[a] = snappedf(Input.get_axis(pair[0], pair[1]), 0.001) if pair.size() == 2 else 0.0
		else:
			ins[a] = 1 if Input.is_action_pressed(a) else 0
	_lines.append(JSON.stringify({
		"k": "frame",
		"f": _frame,
		"t": snappedf(_frame / float(_fixed_fps), 0.000001),
		"in": ins,
		"e": ents,
	}))


func _apply_event(ev: Dictionary) -> void:
	var a: String = ev["a"]
	var v: float = float(ev["v"])
	if _actions.get(a) == "axis":
		var pair: Array = _axes.get(a, [])
		if pair.size() != 2:
			push_error("kite: axis \"%s\" has no mapping in %s" % [a, CONFIG_PATH])
			return
		if v > 0.0:
			Input.action_release(pair[0])
			Input.action_press(pair[1], v)
		elif v < 0.0:
			Input.action_release(pair[1])
			Input.action_press(pair[0], -v)
		else:
			Input.action_release(pair[0])
			Input.action_release(pair[1])
	else:
		if v > 0.0:
			Input.action_press(a)
		else:
			Input.action_release(a)


func _finish() -> void:
	_running = false
	var abs_out := _absolute(_out_path)
	DirAccess.make_dir_recursive_absolute(abs_out.get_base_dir())
	var fa := FileAccess.open(abs_out, FileAccess.WRITE)
	if fa == null:
		push_error("kite: cannot open output file %s" % abs_out)
		get_tree().quit(1)
		return
	fa.store_line(_meta_line())
	for l in _lines:
		fa.store_line(l)
	fa.close()
	print("kite: recorded %d frames -> %s" % [_lines.size(), _out_path])
	get_tree().quit(0)


func _meta_line() -> String:
	var vi := Engine.get_version_info()
	var ents := {}
	for n in _tracked:
		var src: String = n.scene_file_path if n.scene_file_path != "" else "inline"
		ents[String(n.name)] = "%s (%s)" % [n.get_class(), src]
	# The viewport (in project coordinate units) is the reference for scale-
	# relative metrics - e.g. screenshake reported as a fraction of screen size,
	# so a contract means the same felt shake at any resolution.
	var vw := int(ProjectSettings.get_setting("display/window/size/viewport_width", 0))
	var vh := int(ProjectSettings.get_setting("display/window/size/viewport_height", 0))
	return JSON.stringify({
		"k": "meta",
		"kite_telemetry": TELEMETRY_VERSION,
		"engine": "godot",
		"engine_version": "%d.%d.%d" % [vi.major, vi.minor, vi.patch],
		"adapter_version": ADAPTER_VERSION,
		"test": _test_path.get_file().replace(".inputs.json", ""),
		"scene": get_tree().current_scene.scene_file_path,
		"fixed_fps": _fixed_fps,
		"seed": _seed,
		"input_script": _test_path,
		"input_script_sha256": FileAccess.get_sha256(_absolute(_test_path)),
		"units": {"position": "px", "velocity": "px/s", "time": "s"},
		"viewport": [vw, vh],
		"entities": ents,
		"started_utc": _started_utc,
	})


func _load_input_script() -> bool:
	var raw := FileAccess.get_file_as_string(_absolute(_test_path))
	if raw == "":
		push_error("kite: cannot read input script %s" % _test_path)
		return false
	var data: Variant = JSON.parse_string(raw)
	if data == null or not data is Dictionary or not data.has("events"):
		push_error("kite: %s is not a kite_inputs file" % _test_path)
		return false
	_actions = data.get("actions", {})
	_events = []
	for ev in data["events"]:
		if ev["a"] == "end":
			_end_frame = int(ev["f"])
		else:
			_events.append(ev)
	_events.sort_custom(func(x, y): return int(x["f"]) < int(y["f"]))
	if _end_frame < 0:
		push_error("kite: %s has no end event" % _test_path)
		return false
	return true


func _load_config() -> void:
	if not FileAccess.file_exists(CONFIG_PATH):
		return
	var data: Variant = JSON.parse_string(FileAccess.get_file_as_string(CONFIG_PATH))
	if data is Dictionary:
		_axes = data.get("axes", {})


func _config_scene() -> String:
	if not FileAccess.file_exists(CONFIG_PATH):
		return ""
	var data: Variant = JSON.parse_string(FileAccess.get_file_as_string(CONFIG_PATH))
	return data.get("scene", "") if data is Dictionary else ""


func _parse_user_args() -> Dictionary:
	var out := {}
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--") and arg.contains("="):
			var kv := arg.trim_prefix("--").split("=", true, 1)
			out[kv[0]] = kv[1]
	return out


func _absolute(path: String) -> String:
	if path.begins_with("res://") or path.begins_with("user://"):
		return path
	return "res://" + path
